/**
 * Assessment Notice Upload API
 *
 * Allows users to upload their property tax assessment notice.
 * Extracts key data including:
 * - Property PIN
 * - Current assessed value
 * - Prior assessed value
 * - Property characteristics (bedrooms, sqft, etc.)
 * - Appeal deadline
 *
 * POST /api/property-tax/upload-notice
 * Body: FormData with 'file' (image/PDF)
 * Response: { extractedData: AssessmentNoticeData }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Disable Next.js body parsing for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

interface AssessmentNoticeData {
  pin?: string;
  pinFormatted?: string;
  address?: string;
  township?: string;
  propertyClass?: string;
  // Assessment values
  currentAssessedValue?: number;
  priorAssessedValue?: number;
  currentMarketValue?: number;
  priorMarketValue?: number;
  assessmentChange?: number;
  assessmentChangePercent?: number;
  // Property characteristics
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: number;
  lotSize?: number;
  // Deadline info
  appealDeadline?: string;
  appealDeadlineDays?: number;
  // Raw extracted text for debugging
  rawText?: string;
  // Confidence in extraction
  confidence: 'high' | 'medium' | 'low';
  // Any errors or warnings
  warnings?: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - 10 uploads per hour per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  try {
    // Parse the form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB max
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);
    const uploadedFile = files.file?.[0];

    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(uploadedFile.mimetype || '')) {
      return res.status(400).json({
        error: 'Invalid file type. Please upload an image (JPG, PNG) or PDF.'
      });
    }

    // Read file content
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    const base64Content = fileBuffer.toString('base64');

    // Use Claude to extract data from the assessment notice
    const extractedData = await extractAssessmentData(
      base64Content,
      uploadedFile.mimetype || 'image/jpeg'
    );

    // Clean up temp file
    fs.unlinkSync(uploadedFile.filepath);

    // If we got a PIN, verify it exists in Cook County data
    if (extractedData.pin) {
      // Optionally validate against Cook County API
      // For now, just format it
      extractedData.pinFormatted = formatPin(extractedData.pin);
    }

    // Calculate days until deadline if we have a deadline
    if (extractedData.appealDeadline) {
      const deadline = new Date(extractedData.appealDeadline);
      const now = new Date();
      const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      extractedData.appealDeadlineDays = daysUntil > 0 ? daysUntil : 0;
    }

    return res.status(200).json({
      success: true,
      extractedData,
      message: extractedData.confidence === 'high'
        ? 'Successfully extracted assessment notice data'
        : 'Extracted data may be incomplete - please verify'
    });

  } catch (error) {
    console.error('Assessment notice upload error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    return res.status(500).json({
      error: 'Failed to process assessment notice. Please try again or enter data manually.',
      detail: errorMessage
    });
  }
}

/**
 * Extract assessment data from an uploaded image/PDF using Claude vision
 */
async function extractAssessmentData(
  base64Content: string,
  mimeType: string
): Promise<AssessmentNoticeData> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const prompt = `You are analyzing a Cook County, Illinois property tax assessment notice.
Extract the following information from this document:

1. Property PIN (14-digit number, format like XX-XX-XXX-XXX-XXXX)
2. Property address
3. Township name
4. Property class code (3-digit number like 202, 211, 299)
5. Current assessed value (the new/proposed assessment)
6. Prior year assessed value
7. Square footage (if shown)
8. Number of bedrooms (if shown)
9. Number of bathrooms (if shown)
10. Year built (if shown)
11. Lot size (if shown)
12. Appeal deadline date (if shown)

Return the data as a JSON object with these exact keys:
{
  "pin": "14-digit PIN without dashes",
  "address": "full street address",
  "township": "township name",
  "propertyClass": "3-digit class code",
  "currentAssessedValue": number,
  "priorAssessedValue": number,
  "squareFootage": number or null,
  "bedrooms": number or null,
  "bathrooms": number or null,
  "yearBuilt": number or null,
  "lotSize": number or null,
  "appealDeadline": "YYYY-MM-DD format or null",
  "confidence": "high" | "medium" | "low",
  "warnings": ["array of any issues or missing data"]
}

Important:
- Remove dashes from the PIN for the "pin" field
- Convert all values to numbers where applicable
- If you cannot read a value clearly, set it to null
- Set confidence to "low" if document is blurry or incomplete
- Include warnings for any fields you're uncertain about

Return ONLY the JSON object, no other text.`;

  // Handle PDF vs image
  const mediaType = mimeType === 'application/pdf' ? 'application/pdf' : mimeType as any;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Content,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  // Parse the response
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response format from Claude');
  }

  try {
    // Extract JSON from response (in case there's any extra text)
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const data = JSON.parse(jsonMatch[0]) as AssessmentNoticeData;

    // Calculate derived values
    if (data.currentAssessedValue && data.priorAssessedValue) {
      data.assessmentChange = data.currentAssessedValue - data.priorAssessedValue;
      data.assessmentChangePercent = data.priorAssessedValue > 0
        ? Math.round(((data.currentAssessedValue - data.priorAssessedValue) / data.priorAssessedValue) * 1000) / 10
        : null;
      // Cook County: market value = assessed value × 10
      data.currentMarketValue = data.currentAssessedValue * 10;
      data.priorMarketValue = data.priorAssessedValue * 10;
    }

    return data;
  } catch (parseError) {
    console.error('Error parsing Claude response:', content.text);
    throw new Error('Failed to parse assessment notice data');
  }
}

/**
 * Format a 14-digit PIN with dashes
 */
function formatPin(pin: string): string {
  const cleaned = pin.replace(/\D/g, '').padStart(14, '0');
  return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7, 10)}-${cleaned.slice(10, 14)}`;
}
