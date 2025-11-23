/**
 * Validate Driver's License Image - Instant Feedback
 *
 * Validates image quality WITHOUT uploading to storage.
 * Provides instant feedback to user before committing to upload.
 *
 * Security:
 * - Validates file type (images only)
 * - Limits file size (5MB max)
 * - Uses Google Cloud Vision for quality check
 */

import { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import vision from '@google-cloud/vision';

// Configure formidable to NOT parse by default
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Initialize Google Cloud Vision client
let visionClient: vision.ImageAnnotatorClient | null = null;
if (process.env.GOOGLE_CLOUD_VISION_CREDENTIALS) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CLOUD_VISION_CREDENTIALS);
    visionClient = new vision.ImageAnnotatorClient({ credentials });
  } catch (error) {
    console.warn('Failed to initialize Google Cloud Vision:', error);
  }
}

/**
 * Extract expiry date from license text
 * Looks for patterns like: EXP 03/15/2027, EXPIRES 03-15-27, etc.
 */
function extractExpiryDate(text: string): string | null {
  console.log('🔍 Attempting to extract expiry date from text...');
  console.log('Full text length:', text.length);
  console.log('First 500 chars:', text.substring(0, 500));

  const lines = text.split('\n');

  // Illinois and other state-specific patterns
  const patterns = [
    // Pattern 1: EXP, EXPIRES, EXPIRATION with date
    /(?:EXP|EXPIRES?|EXPIRATION|EXP\s*DATE)[:\s]*(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{2,4})/i,

    // Pattern 2: Date after specific keywords
    /(?:4[ab]|4d)[:\s]+(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{2,4})/i, // Illinois uses "4b" or "4d" for expiry

    // Pattern 3: Look for future dates (must be after today and before 2050)
    /\b(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{2,4})\b/g,
  ];

  const today = new Date();
  const maxDate = new Date('2050-01-01');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of patterns) {
      pattern.lastIndex = 0; // Reset regex
      const matches = line.matchAll(pattern);

      for (const match of matches) {
        let month = match[1];
        let day = match[2];
        let year = match[3];

        // Handle 2-digit years
        if (year.length === 2) {
          const yearNum = parseInt(year);
          // If year is 00-50, assume 2000s, otherwise 1900s
          year = yearNum <= 50 ? String(2000 + yearNum) : String(1900 + yearNum);
        }

        // Basic validation
        const monthNum = parseInt(month);
        const dayNum = parseInt(day);
        const yearNum = parseInt(year);

        if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
          const expiryDate = new Date(yearNum, monthNum - 1, dayNum);

          // Must be a future date and before 2050
          if (expiryDate > today && expiryDate < maxDate) {
            const isoDate = expiryDate.toISOString().split('T')[0];
            console.log(`✅ Found valid expiry date on line ${i}: ${line.trim()}`);
            console.log(`   Parsed as: ${isoDate}`);
            return isoDate;
          } else {
            console.log(`   Rejected date (not in valid range): ${expiryDate.toISOString().split('T')[0]}`);
          }
        }
      }
    }
  }

  console.log('❌ No valid expiry date found');
  return null;
}

/**
 * Validate image with Google Cloud Vision
 */
async function validateWithGoogleVision(filePath: string): Promise<{ valid: boolean; reason?: string; detectedExpiryDate?: string }> {
  if (!visionClient) {
    console.warn('Google Vision client not initialized, skipping validation');
    return { valid: true };
  }

  try {
    const [result] = await visionClient.documentTextDetection(filePath);

    // Check 1: Text detection (must have readable text)
    const fullText = result.fullTextAnnotation?.text || '';

    if (!fullText || fullText.trim().length < 20) {
      return { valid: false, reason: 'Unable to read text from image. Please ensure the license is clearly visible and in focus.' };
    }

    console.log('✓ Text detected:', fullText.substring(0, 100) + '...');

    // Try to extract expiry date
    const detectedExpiryDate = extractExpiryDate(fullText);
    if (detectedExpiryDate) {
      console.log('✓ Detected expiry date:', detectedExpiryDate);
    }

    // Check 2: Safe search (must be appropriate content)
    const safeSearch = result.safeSearchAnnotation;
    if (safeSearch && (
      safeSearch.adult === 'VERY_LIKELY' ||
      safeSearch.violence === 'VERY_LIKELY'
    )) {
      return { valid: false, reason: 'Invalid image content detected. Please upload a photo of your driver\'s license.' };
    }

    // Check 3: Brightness check (must not be too dark or too bright)
    const imageProps = result.imagePropertiesAnnotation;
    if (imageProps?.dominantColors?.colors && imageProps.dominantColors.colors.length > 0) {
      const colors = imageProps.dominantColors.colors;
      const avgBrightness = colors.reduce((sum, color) => {
        const r = color.color?.red || 0;
        const g = color.color?.green || 0;
        const b = color.color?.blue || 0;
        return sum + (r + g + b) / 3;
      }, 0) / colors.length;

      if (avgBrightness > 240) {
        return { valid: false, reason: 'Image is overexposed or has glare. Please retake without flash or direct light.' };
      }

      if (avgBrightness < 30) {
        return { valid: false, reason: 'Image is too dark. Please retake in better lighting.' };
      }
    }

    // Check 4: Label detection (should detect "document", "id card", "text", etc.)
    const labels = result.labelAnnotations || [];
    const documentLabels = ['document', 'id', 'card', 'text', 'paper', 'license', 'identification'];
    const hasDocumentLabels = labels.some(label =>
      documentLabels.some(dl => label.description?.toLowerCase().includes(dl))
    );

    if (!hasDocumentLabels) {
      return { valid: false, reason: 'Unable to identify this as a document. Please ensure the entire license is visible and in focus.' };
    }

    console.log('✓ Google Vision validation passed');
    return {
      valid: true,
      detectedExpiryDate: detectedExpiryDate || undefined
    };

  } catch (error: any) {
    console.error('Google Vision validation error:', error);
    // Don't fail validation if Vision API has an error
    console.warn('Skipping Google Vision check due to error');
    return { valid: true };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse form data
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const file = Array.isArray(files.license) ? files.license[0] : files.license;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.mimetype || '')) {
      // Clean up temp file
      fs.unlinkSync(file.filepath);
      return res.status(400).json({
        valid: false,
        error: 'Invalid file type. Only JPEG, PNG, and WebP images allowed.'
      });
    }

    // Validate with Google Cloud Vision
    console.log('🔍 Validating image with Google Cloud Vision...');
    const visionCheck = await validateWithGoogleVision(file.filepath);

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    if (!visionCheck.valid) {
      console.log('❌ Validation failed:', visionCheck.reason);
      return res.status(400).json({
        valid: false,
        error: visionCheck.reason || 'Image validation failed'
      });
    }

    console.log('✅ Validation passed!');
    return res.status(200).json({
      valid: true,
      message: 'Image looks good!',
      detectedExpiryDate: visionCheck.detectedExpiryDate
    });

  } catch (error: any) {
    console.error('License validation error:', error);
    return res.status(500).json({
      valid: false,
      error: 'Validation failed',
      details: error.message
    });
  }
}
