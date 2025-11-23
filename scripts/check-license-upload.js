const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLicenseUpload(email) {
  console.log(`\n🔍 Checking license upload for: ${email}\n`);

  // 1. Find user
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log(`✓ Found user ID: ${userId}`);

  // 2. Check database fields
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('license_image_path, license_image_uploaded_at, license_image_verified, license_image_path_back, license_image_back_uploaded_at, license_image_back_verified')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.log('❌ Error fetching profile:', error.message);
    return;
  }

  console.log('\n📋 Database Status:');
  console.log('─'.repeat(60));

  // Front
  if (profile.license_image_path) {
    console.log('✅ FRONT LICENSE:');
    console.log(`   Path: ${profile.license_image_path}`);
    console.log(`   Uploaded: ${profile.license_image_uploaded_at || 'N/A'}`);
    console.log(`   Verified: ${profile.license_image_verified ? 'Yes' : 'No'}`);
  } else {
    console.log('⚠️  FRONT LICENSE: Not uploaded');
  }

  console.log('');

  // Back
  if (profile.license_image_path_back) {
    console.log('✅ BACK LICENSE:');
    console.log(`   Path: ${profile.license_image_path_back}`);
    console.log(`   Uploaded: ${profile.license_image_back_uploaded_at || 'N/A'}`);
    console.log(`   Verified: ${profile.license_image_back_verified ? 'Yes' : 'No'}`);
  } else {
    console.log('⚠️  BACK LICENSE: Not uploaded');
  }

  // 3. Check Supabase Storage bucket
  console.log('\n\n📦 Storage Bucket Status:');
  console.log('─'.repeat(60));

  const { data: files, error: listError } = await supabase.storage
    .from('license-images-temp')
    .list(`licenses`, {
      search: userId
    });

  if (listError) {
    console.log('❌ Error listing files:', listError.message);
    return;
  }

  if (files && files.length > 0) {
    console.log(`✅ Found ${files.length} file(s) in storage:\n`);
    files.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.name}`);
      console.log(`      Size: ${(file.metadata.size / 1024).toFixed(2)} KB`);
      console.log(`      Created: ${file.created_at}`);
      console.log('');
    });
  } else {
    console.log('⚠️  No files found in storage bucket');
  }

  // 4. Generate signed URL for viewing (if exists)
  if (profile.license_image_path) {
    console.log('\n🔗 Signed URL (valid 1 hour):');
    console.log('─'.repeat(60));
    const { data: signedUrl, error: urlError } = await supabase.storage
      .from('license-images-temp')
      .createSignedUrl(profile.license_image_path, 3600);

    if (urlError) {
      console.log('❌ Error generating URL:', urlError.message);
    } else {
      console.log(`\n${signedUrl.signedUrl}\n`);
      console.log('(Copy and paste into browser to view front license)');
    }
  }

  if (profile.license_image_path_back) {
    const { data: signedUrlBack, error: urlErrorBack } = await supabase.storage
      .from('license-images-temp')
      .createSignedUrl(profile.license_image_path_back, 3600);

    if (!urlErrorBack) {
      console.log(`\n${signedUrlBack.signedUrl}\n`);
      console.log('(Copy and paste into browser to view back license)');
    }
  }

  console.log('\n✅ Check complete!\n');
}

// Get email from command line
const email = process.argv[2];

if (!email) {
  console.log('Usage: node scripts/check-license-upload.js <email>');
  console.log('Example: node scripts/check-license-upload.js test@example.com');
  process.exit(1);
}

checkLicenseUpload(email);
