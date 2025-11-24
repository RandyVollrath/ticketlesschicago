/**
 * Test Google Cloud Vision API Configuration
 *
 * Verifies that Vision API credentials are valid and working
 */

require('dotenv').config({ path: '.env.local' });
const vision = require('@google-cloud/vision');

async function testVisionAPI() {
  console.log('\n🧪 Testing Google Cloud Vision API Configuration');
  console.log('='.repeat(60));

  // Step 1: Check if credentials exist
  console.log('\n1. Checking credentials...');
  if (!process.env.GOOGLE_CLOUD_VISION_CREDENTIALS) {
    console.log('❌ GOOGLE_CLOUD_VISION_CREDENTIALS not found in environment');
    return;
  }
  console.log('✅ Credentials found in environment');

  // Step 2: Parse credentials
  console.log('\n2. Parsing credentials...');
  let credentials;
  try {
    // Fix credentials: Replace literal newlines in private_key with \n escape sequences
    const rawCreds = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    const fixedCreds = rawCreds.replace(/"private_key":\s*"([^"]*?)"/gs, (match, key) => {
      const escaped = key.replace(/\n/g, '\\n');
      return `"private_key": "${escaped}"`;
    });
    credentials = JSON.parse(fixedCreds);
    console.log('✅ Credentials parsed successfully');
    console.log('   Project ID:', credentials.project_id || 'NOT FOUND');
    console.log('   Client Email:', credentials.client_email || 'NOT FOUND');
  } catch (error) {
    console.log('❌ Failed to parse credentials:', error.message);
    return;
  }

  // Step 3: Initialize Vision client
  console.log('\n3. Initializing Vision client...');
  let visionClient;
  try {
    visionClient = new vision.ImageAnnotatorClient({ credentials });
    console.log('✅ Vision client initialized');
  } catch (error) {
    console.log('❌ Failed to initialize Vision client:', error.message);
    return;
  }

  // Step 4: Test with a simple text detection (base64 encoded "TEST" image)
  console.log('\n4. Testing Vision API with sample image...');
  try {
    // Simple 1x1 white pixel PNG (base64)
    const testImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    const [result] = await visionClient.documentTextDetection({
      image: { content: testImage }
    });

    console.log('✅ Vision API call succeeded');
    console.log('   Response received:', !!result);
    console.log('   Text annotations:', result.textAnnotations?.length || 0);

    if (result.fullTextAnnotation) {
      console.log('   Full text:', result.fullTextAnnotation.text?.substring(0, 100) || 'None');
    }

  } catch (error) {
    console.log('❌ Vision API call failed:', error.message);
    console.log('   Error details:', error);
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Google Cloud Vision API is properly configured!');
  console.log('\nYou can now upload license images and they will be validated.\n');
}

testVisionAPI().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
