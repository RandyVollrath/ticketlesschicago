/**
 * Test License OCR
 *
 * Downloads user's uploaded license and runs OCR to see what Vision API detects
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const vision = require('@google-cloud/vision');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

/**
 * Extract expiry date from text (same logic as API)
 */
function extractExpiryDate(text) {
  console.log('\n🔍 Attempting to extract expiry date from text...');
  console.log('Full text length:', text.length);
  console.log('\n📝 FULL OCR TEXT:');
  console.log('═'.repeat(80));
  console.log(text);
  console.log('═'.repeat(80));

  const lines = text.split('\n');

  const patterns = [
    // Pattern 1: EXP with colon and slash (EXP: 06/30/2027)
    /EXP\s*:\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/i,

    // Pattern 2: Illinois-specific "4b" or "4d" followed by date
    /(?:4[abd])\s*\.?\s*(?:EXP|EXPIRES?)?[\s:]*(\d{1,2})[\s\-\/](\d{1,2})[\s\-\/](\d{2,4})/i,

    // Pattern 3: EXP, EXPIRES, EXPIRATION with date (various separators)
    /(?:EXP|EXPIRES?|EXPIRATION|EXP\s*DATE)[\s:\.]*(\d{1,2})[\s\-\/\.]*(\d{1,2})[\s\-\/\.]*(\d{2,4})/i,

    // Pattern 4: "VALID UNTIL" or similar
    /(?:VALID\s*(?:UNTIL|THRU|THROUGH)|GOOD\s*(?:UNTIL|THRU))[\s:\.]*(\d{1,2})[\s\-\/](\d{1,2})[\s\-\/](\d{2,4})/i,

    // Pattern 5: Just digits with separators (very permissive)
    /(\d{1,2})[\s\-\/\.]+(\d{1,2})[\s\-\/\.]+(\d{2,4})/g,
  ];

  const today = new Date();
  const maxDate = new Date('2050-01-01');

  console.log('\n📋 LINE-BY-LINE ANALYSIS:');
  console.log('─'.repeat(80));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;

    console.log(`\nLine ${i}: "${line.trim()}"`);

    for (let p = 0; p < patterns.length; p++) {
      const pattern = patterns[p];
      pattern.lastIndex = 0;
      const matches = line.matchAll(pattern);

      for (const match of matches) {
        console.log(`  ✅ Pattern ${p + 1} matched!`);
        console.log(`  📅 Captured groups:`, match.slice(1, 4));

        let month = match[1];
        let day = match[2];
        let year = match[3];

        // Handle 2-digit years
        if (year.length === 2) {
          const yearNum = parseInt(year);
          year = yearNum <= 50 ? String(2000 + yearNum) : String(1900 + yearNum);
        }

        const monthNum = parseInt(month);
        const dayNum = parseInt(day);
        const yearNum = parseInt(year);

        if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
          const expiryDate = new Date(yearNum, monthNum - 1, dayNum);

          if (expiryDate > today && expiryDate < maxDate) {
            const isoDate = expiryDate.toISOString().split('T')[0];
            console.log(`  ✅ VALID EXPIRY DATE FOUND: ${isoDate}`);
            return isoDate;
          } else {
            console.log(`  ❌ Date out of valid range: ${expiryDate.toISOString().split('T')[0]}`);
          }
        } else {
          console.log(`  ❌ Invalid date values: month=${monthNum}, day=${dayNum}`);
        }
      }
    }
  }

  console.log('\n❌ No valid expiry date found');
  return null;
}

async function testOCR(email) {
  try {
    // Find user
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);

    if (!user) {
      console.error('❌ User not found:', email);
      return;
    }

    console.log(`✅ Found user: ${user.email}`);

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('license_image_path')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile.license_image_path) {
      console.error('❌ No license image uploaded');
      return;
    }

    console.log(`📁 License path: ${profile.license_image_path}`);

    // Download image
    const { data: imageData, error: downloadError } = await supabase.storage
      .from('license-images-temp')
      .download(profile.license_image_path);

    if (downloadError) {
      console.error('❌ Download failed:', downloadError.message);
      return;
    }

    // Save temporarily
    const tempPath = path.join('/tmp', 'test-license.jpg');
    const buffer = Buffer.from(await imageData.arrayBuffer());
    fs.writeFileSync(tempPath, buffer);
    console.log(`💾 Downloaded to: ${tempPath}`);

    // Run OCR
    console.log('\n🔍 Running Google Cloud Vision OCR...\n');
    const [result] = await visionClient.documentTextDetection(tempPath);
    const fullText = result.fullTextAnnotation?.text || '';

    if (!fullText) {
      console.error('❌ No text detected');
      return;
    }

    // Extract expiry date
    const detectedDate = extractExpiryDate(fullText);

    if (detectedDate) {
      console.log(`\n✅ SUCCESS! Detected expiry date: ${detectedDate}`);
    } else {
      console.log(`\n❌ FAILED to detect expiry date`);
    }

    // Cleanup
    fs.unlinkSync(tempPath);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

// Get email from args
const email = process.argv[2];

if (!email) {
  console.log('Usage: node scripts/test-license-ocr.js <email>');
  console.log('Example: node scripts/test-license-ocr.js user@example.com');
  process.exit(1);
}

testOCR(email);
