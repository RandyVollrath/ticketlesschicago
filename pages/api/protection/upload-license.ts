/**
 * Upload Driver's License Image - Ephemeral Storage
 *
 * Stores license images temporarily for verification by remitter.
 * Images are automatically cleaned up after 48 hours or after verification.
 *
 * Security:
 * - Validates file type (images only)
 * - Limits file size (5MB max)
 * - Generates unique filenames to prevent overwrites
 * - Uses signed URLs with 24-hour expiration
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import vision from '@google-cloud/vision';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configure formidable to NOT parse by default
export const config = {
  api: {
    bodyParser: false,
  },
};

const BUCKET_NAME = 'license-images-temp';
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
 * Verify image quality using Sharp
 * Checks for blur, brightness, and image dimensions
 */
async function verifyImageQuality(filePath: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const buffer = fs.readFileSync(filePath);
    const metadata = await sharp(buffer).metadata();

    // Check minimum dimensions (should be at least 800x600)
    if (!metadata.width || !metadata.height) {
      return { valid: false, reason: 'Unable to read image dimensions' };
    }

    if (metadata.width < 800 || metadata.height < 600) {
      return {
        valid: false,
        reason: `Image too small (${metadata.width}x${metadata.height}). Minimum 800x600 required for clear text.`
      };
    }

    // Convert to grayscale and analyze blur using Laplacian variance
    const { data, info } = await sharp(buffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Calculate Laplacian variance (measures sharpness)
    // Higher variance = sharper image
    let laplacianSum = 0;
    let count = 0;

    for (let y = 1; y < info.height - 1; y++) {
      for (let x = 1; x < info.width - 1; x++) {
        const idx = y * info.width + x;
        const center = data[idx];
        const up = data[(y - 1) * info.width + x];
        const down = data[(y + 1) * info.width + x];
        const left = data[y * info.width + (x - 1)];
        const right = data[y * info.width + (x + 1)];

        const laplacian = Math.abs(4 * center - up - down - left - right);
        laplacianSum += laplacian * laplacian;
        count++;
      }
    }

    const laplacianVariance = laplacianSum / count;
    console.log(`Image quality metrics: variance=${laplacianVariance.toFixed(2)}, dimensions=${metadata.width}x${metadata.height}`);

    // Threshold for acceptable sharpness (empirically determined)
    // Lower values indicate blur
    const MIN_SHARPNESS = 100; // Adjust based on testing

    if (laplacianVariance < MIN_SHARPNESS) {
      return {
        valid: false,
        reason: `Image appears blurry (sharpness: ${laplacianVariance.toFixed(0)}). Please take a clearer photo in good lighting.`
      };
    }

    // Check for brightness (too dark or overexposed)
    const stats = await sharp(buffer).stats();
    const avgBrightness = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;

    console.log(`Brightness: ${avgBrightness.toFixed(2)}`);

    if (avgBrightness < 30) {
      return { valid: false, reason: 'Image too dark. Please take photo in better lighting.' };
    }

    if (avgBrightness > 240) {
      return { valid: false, reason: 'Image overexposed. Please reduce lighting or avoid flash glare.' };
    }

    return { valid: true };

  } catch (error: any) {
    console.error('Image quality verification error:', error);
    return { valid: false, reason: 'Failed to analyze image quality' };
  }
}

/**
 * Verify driver's license using Google Cloud Vision API
 * Checks if text is readable, detects quality issues, verifies it's a document
 */
async function verifyWithGoogleVision(filePath: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    if (!visionClient) {
      console.warn('Google Cloud Vision not configured, skipping AI verification');
      return { valid: true }; // Skip if not configured
    }

    const buffer = fs.readFileSync(filePath);

    // Run multiple Vision API features
    const [result] = await visionClient.annotateImage({
      image: { content: buffer },
      features: [
        { type: 'DOCUMENT_TEXT_DETECTION' }, // OCR for text readability
        { type: 'IMAGE_PROPERTIES' }, // Quality analysis
        { type: 'LABEL_DETECTION' }, // Identify document type
      ],
    });

    // Check 1: Text Detection (must have readable text)
    const textAnnotations = result.textAnnotations;
    if (!textAnnotations || textAnnotations.length === 0) {
      return { valid: false, reason: 'No readable text detected. Please ensure your license is clearly visible and in focus.' };
    }

    const fullText = textAnnotations[0]?.description || '';
    console.log('Detected text length:', fullText.length);

    // Check for minimum text (driver's license should have substantial text)
    if (fullText.length < 50) {
      return { valid: false, reason: 'Insufficient text detected. Image may be too blurry or cut off. Please retake with better lighting.' };
    }

    // Check 2: Look for license-related keywords
    const licenseKeywords = ['license', 'driver', 'DL', 'DOB', 'expires', 'issued'];
    const hasLicenseKeywords = licenseKeywords.some(keyword =>
      fullText.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasLicenseKeywords) {
      return { valid: false, reason: 'This doesn\'t appear to be a driver\'s license. Please upload your driver\'s license, not a passport or other ID.' };
    }

    // Check 3: Image quality analysis
    const imageProps = result.imagePropertiesAnnotation;
    if (imageProps?.dominantColors?.colors) {
      const colors = imageProps.dominantColors.colors;

      // Check for extreme brightness/darkness (glare or underexposure)
      const avgBrightness = colors.reduce((sum, color) => {
        const brightness = ((color.color?.red || 0) + (color.color?.green || 0) + (color.color?.blue || 0)) / 3;
        return sum + brightness * (color.pixelFraction || 0);
      }, 0);

      if (avgBrightness > 240) {
        return { valid: false, reason: 'Image is overexposed or has significant glare. Please retake without flash or direct light.' };
      }

      if (avgBrightness < 30) {
        return { valid: false, reason: 'Image is too dark. Please retake in better lighting.' };
      }
    }

    // Check 4: Label detection (should detect "document", "id card", "text", etc.)
    const labels = result.labelAnnotations || [];
    const documentLabels = ['document', 'id', 'card', 'text', 'paper'];
    const hasDocumentLabels = labels.some(label =>
      documentLabels.some(dl => label.description?.toLowerCase().includes(dl))
    );

    if (!hasDocumentLabels) {
      return { valid: false, reason: 'Unable to identify this as a document. Please ensure the entire license is visible and in focus.' };
    }

    console.log('✓ Google Vision verification passed');
    return { valid: true };

  } catch (error: any) {
    console.error('Google Vision verification error:', error);
    // Don't fail the upload if Google Vision has an error - Sharp already passed
    console.warn('Skipping Google Vision check due to error, continuing with Sharp verification only');
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

    const userId = Array.isArray(fields.userId) ? fields.userId[0] : fields.userId;
    const file = Array.isArray(files.license) ? files.license[0] : files.license;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.mimetype || '')) {
      return res.status(400).json({
        error: 'Invalid file type. Only JPEG, PNG, and WebP images allowed.'
      });
    }

    // Layer 1: Verify image quality with Sharp (blur, brightness, dimensions)
    console.log('🔍 Layer 1: Verifying image quality with Sharp...');
    const qualityCheck = await verifyImageQuality(file.filepath);

    if (!qualityCheck.valid) {
      console.log('❌ Sharp quality check failed:', qualityCheck.reason);
      // Clean up temp file
      fs.unlinkSync(file.filepath);
      return res.status(400).json({
        error: qualityCheck.reason || 'Image quality check failed'
      });
    }

    console.log('✓ Sharp verification passed');

    // Layer 2: Verify with Google Cloud Vision (text readability, document type, quality)
    console.log('🔍 Layer 2: Verifying with Google Cloud Vision API...');
    const visionCheck = await verifyWithGoogleVision(file.filepath);

    if (!visionCheck.valid) {
      console.log('❌ Google Vision check failed:', visionCheck.reason);
      // Clean up temp file
      fs.unlinkSync(file.filepath);
      return res.status(400).json({
        error: visionCheck.reason || 'Driver\'s license verification failed'
      });
    }

    console.log('✓ Google Vision verification passed');
    console.log('✅ All verification checks passed!');

    // Generate unique filename
    const fileExt = file.originalFilename?.split('.').pop() || 'jpg';
    const fileName = `${userId}_${Date.now()}.${fileExt}`;
    const filePath = `licenses/${fileName}`;

    // Read file
    const fileBuffer = fs.readFileSync(file.filepath);

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, fileBuffer, {
        contentType: file.mimetype || 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload file', details: uploadError.message });
    }

    // Generate signed URL (24-hour expiration)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, 86400); // 24 hours

    if (signedUrlError) {
      console.error('Signed URL error:', signedUrlError);
      return res.status(500).json({ error: 'Failed to generate signed URL' });
    }

    // Update user profile with upload info
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        license_image_path: filePath,
        license_image_uploaded_at: new Date().toISOString(),
        license_image_verified: false,
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Profile update error:', updateError);
      // Don't fail the request - image is uploaded successfully
    }

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    return res.status(200).json({
      success: true,
      filePath,
      signedUrl: signedUrlData.signedUrl,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      message: 'License image uploaded successfully. Will be deleted after verification or 48 hours.',
    });

  } catch (error: any) {
    console.error('License upload error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Full error object:', JSON.stringify(error, null, 2));
    return res.status(500).json({
      error: 'Upload failed',
      details: error.message,
      errorType: error.name
    });
  }
}
