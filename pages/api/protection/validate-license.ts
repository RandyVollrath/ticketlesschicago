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
    // Fix credentials: Replace literal newlines in private_key with \n escape sequences
    const rawCreds = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    const fixedCreds = rawCreds.replace(/"private_key":\s*"([^"]*?)"/gs, (match, key) => {
      const escaped = key.replace(/\n/g, '\\n');
      return `"private_key": "${escaped}"`;
    });
    const credentials = JSON.parse(fixedCreds);
    visionClient = new vision.ImageAnnotatorClient({ credentials });
    console.log('✅ Google Cloud Vision initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Google Cloud Vision:', error);
  }
}

/**
 * Extract expiry date from license text
 * Looks for patterns like: EXP 03/15/2027, EXPIRES 03-15-27, etc.
 */
function extractExpiryDate(text: string): string | null {
  console.log('🔍 Attempting to extract expiry date from text...');
  console.log('Full text length:', text.length);
  console.log('📝 FULL OCR TEXT:', text);
  console.log('First 500 chars:', text.substring(0, 500));

  const lines = text.split('\n');

  // Illinois and other state-specific patterns (ordered by specificity)
  // ALL patterns need 'g' flag for matchAll() to work
  const patterns = [
    // Pattern 1: EXP with colon and slash (EXP: 06/30/2027)
    /EXP\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/gi,

    // Pattern 2: Illinois-specific "4b" or "4d" followed by date (matches "4b EXP: 06/30/2027")
    /(?:4[abd])\s*\.?\s*(?:EXP|EXPIRES?)?[\s:]*(\d{1,2})[\s\-\/](\d{1,2})[\s\-\/](\d{2,4})/gi,

    // Pattern 3: EXP, EXPIRES, EXPIRATION with date (various separators, very flexible)
    /(?:EXP|EXPIRES?|EXPIRATION|EXP\s*DATE)[\s:\.]*(\d{1,2})[\s\-\/\.]*(\d{1,2})[\s\-\/\.]*(\d{2,4})/gi,

    // Pattern 4: "VALID UNTIL" or similar
    /(?:VALID\s*(?:UNTIL|THRU|THROUGH)|GOOD\s*(?:UNTIL|THRU))[\s:\.]*(\d{1,2})[\s\-\/](\d{1,2})[\s\-\/](\d{2,4})/gi,

    // Pattern 5: Just digits with separators (very permissive - any future date)
    /(\d{1,2})[\s\-\/\.]+(\d{1,2})[\s\-\/\.]+(\d{2,4})/g,
  ];

  const today = new Date();
  const maxDate = new Date('2050-01-01');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue; // Skip empty lines

    // Log every line for debugging
    console.log(`📋 Line ${i}: "${line.trim()}"`);

    for (let p = 0; p < patterns.length; p++) {
      const pattern = patterns[p];
      pattern.lastIndex = 0; // Reset regex
      const matches = line.matchAll(pattern);

      for (const match of matches) {
        console.log(`   ✅ Pattern ${p + 1} matched on line ${i}: "${line.trim()}"`);
        console.log(`   📅 Captured groups:`, match.slice(1, 4));

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
 * Fallback validation without Vision API
 * Basic checks to catch obviously bad images
 */
async function fallbackValidation(filePath: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // Check minimum file size (real license photos are usually > 50KB)
    if (fileSize < 50 * 1024) {
      return { valid: false, reason: 'Image file too small. Please upload a clear photo of your license.' };
    }

    // Try to read basic image metadata
    // Note: Sharp is disabled for Vercel compatibility, so we skip dimension checks
    console.log('✓ Fallback validation: File size OK');
    return { valid: true };

  } catch (error: any) {
    console.error('Fallback validation error:', error);
    return { valid: false, reason: 'Unable to process image file' };
  }
}

/**
 * Validate image with Google Cloud Vision (with retry logic)
 */
async function validateWithGoogleVision(filePath: string): Promise<{ valid: boolean; reason?: string; detectedExpiryDate?: string }> {
  if (!visionClient) {
    console.warn('⚠️  Google Vision client not initialized - using fallback validation');
    const fallback = await fallbackValidation(filePath);
    if (!fallback.valid) {
      return fallback;
    }
    // If fallback passes, allow but warn
    console.warn('⚠️  Proceeding without AI validation - manual review may be needed');
    return { valid: true };
  }

  // Retry logic: try up to 3 times with exponential backoff
  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000; // 2s, 4s, 8s
        console.log(`⏳ Retry attempt ${attempt}/${maxRetries} after ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }

      // Use annotateImage to get multiple features at once
      const [result] = await visionClient.annotateImage({
        image: { source: { filename: filePath } },
        features: [
          { type: 'DOCUMENT_TEXT_DETECTION' }, // OCR for text readability
          { type: 'IMAGE_PROPERTIES' }, // Quality analysis
          { type: 'LABEL_DETECTION' }, // Identify document type
          { type: 'SAFE_SEARCH_DETECTION' }, // Content safety
        ],
      });

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
      lastError = error;
      console.error(`❌ Vision API attempt ${attempt}/${maxRetries} failed:`, error.message);

      // If this was the last retry, continue to fallback
      if (attempt === maxRetries) {
        break;
      }
      // Otherwise, continue loop to retry
    }
  }

  // All Vision API retries failed - use fallback validation
  console.error('❌ Vision API failed after all retries:', lastError?.message);
  console.log('🔄 Falling back to basic validation...');

  const fallback = await fallbackValidation(filePath);
  if (!fallback.valid) {
    // Fallback also failed - reject the image
    return fallback;
  }

  // Fallback passed but we couldn't run full AI validation
  // This is a concerning state - accept but log prominently
  console.warn('⚠️  WARNING: Accepted image without AI validation! Manual review recommended.');
  console.warn('⚠️  Vision API error:', lastError?.message);

  return {
    valid: true,
    // Don't return detected date since we couldn't run OCR
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
