const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load .env.local
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

async function checkUploads() {
  console.log('🔍 Checking License Uploads\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Check user profile for Randy
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, email, license_image_path, license_image_uploaded_at, license_image_verified')
    .eq('email', 'randyvollrath@gmail.com')
    .single();

  if (profileError) {
    console.error('❌ Error fetching profile:', profileError);
    return;
  }

  console.log('👤 User Profile:');
  console.log('  Email:', profile.email);
  console.log('  License Path:', profile.license_image_path || '❌ Not set');
  console.log('  Uploaded At:', profile.license_image_uploaded_at || '❌ Not set');
  console.log('  Verified:', profile.license_image_verified ? '✅ Yes' : '❌ No');
  console.log('');

  // Check actual files in storage bucket
  console.log('📦 Checking Storage Bucket...\n');

  const { data: files, error: listError } = await supabase.storage
    .from('license-images-temp')
    .list('licenses', {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' }
    });

  if (listError) {
    console.error('❌ Error listing files:', listError);
    return;
  }

  console.log(`Found ${files.length} file(s) in bucket:\n`);

  for (const file of files) {
    console.log(`📄 ${file.name}`);
    console.log(`   Size: ${(file.metadata.size / 1024).toFixed(2)} KB`);
    console.log(`   Type: ${file.metadata.mimetype}`);
    console.log(`   Created: ${new Date(file.created_at).toLocaleString()}`);
    console.log(`   Updated: ${new Date(file.updated_at).toLocaleString()}`);

    // Check if this is Randy's file
    if (file.name.includes(profile.user_id)) {
      console.log('   👤 This is Randy\'s file!');
    }
    console.log('');
  }

  // Issue: Only ONE file path is stored in the profile
  console.log('⚠️  CURRENT LIMITATION:');
  console.log('The user_profiles table only has ONE license_image_path field.');
  console.log('Each upload OVERWRITES the previous one.');
  console.log('We need to add a separate field for the back of the license.\n');

  console.log('💡 RECOMMENDATIONS:');
  console.log('1. Add license_image_path_back column to user_profiles');
  console.log('2. Update UI to have separate "Front" and "Back" upload buttons');
  console.log('3. City clerk needs BOTH front and back to process permit zone renewals');
}

checkUploads().catch(console.error);
