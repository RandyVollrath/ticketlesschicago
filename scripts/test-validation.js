/**
 * Test License Validation
 *
 * Creates a fake white image and tests if validation properly rejects it
 */

const fs = require('fs');
const path = require('path');
const vision = require('@google-cloud/vision');
require('dotenv').config({ path: '.env.local' });

// Initialize Google Cloud Vision
let visionClient = null;
if (process.env.GOOGLE_CLOUD_VISION_CREDENTIALS) {
  try {
    const rawCreds = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    const fixedCreds = rawCreds.replace(/"private_key":\s*"([^"]*?)"/gs, (match, key) => {
      const escaped = key.replace(/\n/g, '\\n');
      return `"private_key": "${escaped}"`;
    });
    const credentials = JSON.parse(fixedCreds);
    visionClient = new vision.ImageAnnotatorClient({ credentials });
    console.log('✅ Google Cloud Vision initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Vision:', error.message);
    process.exit(1);
  }
}

async function testValidation() {
  console.log('\n🧪 Testing validation with a blank white image...\n');

  // Create a simple white PNG (1x1 pixel)
  const whitePixelPNG = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // bit depth, color type
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, // white pixel data
    0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
    0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  const tempPath = path.join('/tmp', 'test-white-image.png');
  fs.writeFileSync(tempPath, whitePixelPNG);
  console.log('📁 Created test image:', tempPath);

  try {
    // Try to detect text (should find none)
    console.log('\n🔍 Running Vision API...');
    const [result] = await visionClient.annotateImage({
      image: { source: { filename: tempPath } },
      features: [
        { type: 'DOCUMENT_TEXT_DETECTION' },
        { type: 'IMAGE_PROPERTIES' },
        { type: 'LABEL_DETECTION' },
        { type: 'SAFE_SEARCH_DETECTION' },
      ],
    });

    const fullText = result.fullTextAnnotation?.text || '';
    const labels = result.labelAnnotations || [];

    console.log('\n📊 Results:');
    console.log('Text detected:', fullText.length, 'characters');
    console.log('Text content:', fullText ? fullText.substring(0, 100) : '(none)');
    console.log('Labels detected:', labels.map(l => l.description).join(', '));

    // Check if our validation would reject this
    console.log('\n✅ Validation checks:');

    // Check 1: Text detection
    if (!fullText || fullText.trim().length < 20) {
      console.log('✓ Would REJECT: Insufficient text (< 20 chars)');
    } else {
      console.log('✗ Would ACCEPT: Has enough text');
    }

    // Check 2: License keywords
    const licenseKeywords = [
      'license', 'licence', 'driver', 'drivers', 'DL', 'DOB', 'expires', 'issued',
      'illinois', 'state', 'birth', 'sex', 'class', 'endorsement', 'restriction',
      'donor', 'veteran', 'organ', 'height', 'weight', 'eyes', 'hair'
    ];
    const foundKeywords = licenseKeywords.filter(keyword =>
      fullText.toLowerCase().includes(keyword.toLowerCase())
    );
    if (foundKeywords.length < 2) {
      console.log('✓ Would REJECT: Not enough license keywords (<2)');
    } else {
      console.log('✗ Would ACCEPT: Has license keywords:', foundKeywords.join(', '));
    }

    // Check 3: Document labels
    const documentLabels = ['document', 'id', 'card', 'text', 'paper'];
    const hasDocumentLabels = labels.some(label =>
      documentLabels.some(dl => label.description?.toLowerCase().includes(dl))
    );
    if (!hasDocumentLabels) {
      console.log('✓ Would REJECT: Not identified as document');
    } else {
      console.log('✗ Would ACCEPT: Identified as document');
    }

    console.log('\n🎯 FINAL VERDICT:');
    const wouldReject = (!fullText || fullText.trim().length < 20) ||
                        (foundKeywords.length < 2) ||
                        (!hasDocumentLabels);

    if (wouldReject) {
      console.log('✅ Validation is working! Blank image would be REJECTED.');
    } else {
      console.log('⚠️  WARNING: Blank image would be ACCEPTED! Validation may not be working.');
    }

    // Cleanup
    fs.unlinkSync(tempPath);

  } catch (error) {
    console.error('\n❌ Error during test:', error.message);
    console.error('Stack:', error.stack);

    // This is concerning - if Vision API throws an error, does validation accept everything?
    console.log('\n⚠️  CRITICAL: If this error happens during real validation,');
    console.log('    the code returns {valid: true} and accepts the image!');

    fs.unlinkSync(tempPath);
    process.exit(1);
  }
}

testValidation();
