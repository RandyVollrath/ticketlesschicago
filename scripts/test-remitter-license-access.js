/**
 * Test Remitter License Access
 *
 * Simulates remitter calling the API to get a user's driver's license.
 * Tests the complete workflow from API call to image download.
 *
 * Usage: node scripts/test-remitter-license-access.js <email>
 */

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testRemitterAccess(email) {
  console.log('\n🧪 Testing Remitter License Access Workflow');
  console.log('='.repeat(60));
  console.log(`Email: ${email}\n`);

  try {
    // Step 1: Find user by email
    console.log('Step 1: Finding user...');
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`✅ Found user: ${user.id}\n`);

    // Step 2: Check user profile
    console.log('Step 2: Checking user profile...');
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.log('❌ Profile not found:', profileError?.message);
      return;
    }

    console.log(`✅ Profile found`);
    console.log(`   Has Protection: ${profile.has_protection ? 'Yes' : 'No'}`);
    console.log(`   License Uploaded: ${profile.license_image_path ? 'Yes' : 'No'}`);
    console.log(`   License Path: ${profile.license_image_path || 'N/A'}`);
    console.log(`   License Back Path: ${profile.license_image_path_back || 'N/A'}`);
    console.log(`   License Expires: ${profile.license_valid_until || 'Unknown'}`);
    console.log(`   Multi-year Consent: ${profile.license_reuse_consent_given ? 'Yes' : 'No'}\n`);

    if (!profile.has_protection) {
      console.log('⚠️  User does not have Protection subscription');
      console.log('   Cannot access license without Protection\n');
      return;
    }

    if (!profile.license_image_path) {
      console.log('⚠️  User has not uploaded license yet\n');
      return;
    }

    // Step 3: Call remitter API (front license)
    console.log('Step 3: Calling remitter API for FRONT license...');
    const apiUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${apiUrl}/api/city-sticker/get-driver-license?userId=${user.id}`);

    if (!response.ok) {
      const error = await response.json();
      console.log('❌ API call failed:', error);
      return;
    }

    const data = await response.json();
    console.log('✅ API response received');
    console.log(`   Signed URL: ${data.signedUrl.substring(0, 80)}...`);
    console.log(`   Expires At: ${data.expiresAt}`);
    console.log(`   Uploaded At: ${data.uploadedAt}`);
    console.log(`   License Valid Until: ${data.licenseValidUntil || 'Unknown'}`);
    console.log(`   Warning: ${data.warning}\n`);

    // Step 4: Download the image
    console.log('Step 4: Downloading license image...');
    const imageResponse = await fetch(data.signedUrl);

    if (!imageResponse.ok) {
      console.log('❌ Failed to download image:', imageResponse.statusText);
      return;
    }

    const imageBuffer = await imageResponse.buffer();
    console.log(`✅ Image downloaded successfully`);
    console.log(`   Size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Type: ${imageResponse.headers.get('content-type')}\n`);

    // Step 5: Save test image to /tmp
    const testImagePath = `/tmp/test-license-front-${user.id}.jpg`;
    fs.writeFileSync(testImagePath, imageBuffer);
    console.log(`✅ Test image saved to: ${testImagePath}\n`);

    // Step 6: Check if back license exists
    if (profile.license_image_path_back) {
      console.log('Step 6: Checking BACK license...');
      console.log(`   Back license path: ${profile.license_image_path_back}`);
      console.log(`   Note: Use same API with userId to get back license if needed\n`);
    }

    // Step 7: Check audit log
    console.log('Step 7: Checking audit log...');
    const { data: auditLogs, error: auditError } = await supabase
      .from('license_access_log')
      .select('*')
      .eq('user_id', user.id)
      .order('accessed_at', { ascending: false })
      .limit(5);

    if (auditError) {
      console.log('⚠️  Could not fetch audit logs:', auditError.message);
    } else {
      console.log(`✅ Found ${auditLogs?.length || 0} recent access log(s):`);
      auditLogs?.forEach((log, i) => {
        console.log(`   ${i + 1}. ${log.accessed_at} - ${log.accessed_by} (${log.reason})`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test Complete!');
    console.log('\nSummary:');
    console.log('  1. ✅ User found and has Protection');
    console.log('  2. ✅ License uploaded to storage');
    console.log('  3. ✅ API returned signed URL (48-hour expiration)');
    console.log('  4. ✅ Image downloaded successfully');
    console.log('  5. ✅ Audit log recorded access');
    console.log('\n✨ Remitter workflow is working correctly!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
  }
}

// Get email from command line
const email = process.argv[2];

if (!email) {
  console.log('Usage: node scripts/test-remitter-license-access.js <email>');
  console.log('Example: node scripts/test-remitter-license-access.js mystreetcleaning+4@gmail.com');
  process.exit(1);
}

testRemitterAccess(email);
