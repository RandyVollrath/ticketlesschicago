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

async function testUpload() {
  console.log('🧪 Testing License Upload\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('');

  // Check if bucket exists
  console.log('📦 Checking if license-images-temp bucket exists...');
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

  if (bucketsError) {
    console.error('❌ Error listing buckets:', bucketsError);
    return;
  }

  console.log('Available buckets:', buckets.map(b => b.name).join(', '));

  const bucketExists = buckets.some(b => b.name === 'license-images-temp');
  console.log(`license-images-temp exists: ${bucketExists ? '✅' : '❌'}`);

  if (!bucketExists) {
    console.log('\n⚠️  Bucket does not exist! This is likely the issue.');
    console.log('Creating bucket...');

    const { data: newBucket, error: createError } = await supabase.storage.createBucket('license-images-temp', {
      public: false,
      fileSizeLimit: 5242880, // 5MB
      allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    });

    if (createError) {
      console.error('❌ Error creating bucket:', createError);
      console.error('Details:', JSON.stringify(createError, null, 2));
    } else {
      console.log('✅ Bucket created successfully!');
    }
  }

  // Test upload with dummy file
  console.log('\n📤 Testing file upload...');
  const testContent = 'test image content';
  const testPath = 'licenses/test_upload.txt';

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('license-images-temp')
    .upload(testPath, Buffer.from(testContent), {
      contentType: 'text/plain',
      upsert: true
    });

  if (uploadError) {
    console.error('❌ Upload error:', uploadError);
    console.error('Error details:', JSON.stringify(uploadError, null, 2));
  } else {
    console.log('✅ Test upload successful!');
    console.log('Path:', uploadData.path);

    // Clean up test file
    await supabase.storage.from('license-images-temp').remove([testPath]);
    console.log('✅ Test file cleaned up');
  }
}

testUpload().catch(console.error);
