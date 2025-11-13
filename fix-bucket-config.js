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

async function fixBucket() {
  console.log('🔧 Fixing license-images-temp bucket configuration\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Update bucket to allow image mime types
  const { data, error } = await supabase.storage.updateBucket('license-images-temp', {
    public: false,
    fileSizeLimit: 5242880, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  });

  if (error) {
    console.error('❌ Error updating bucket:', error);
    console.error('Details:', JSON.stringify(error, null, 2));
  } else {
    console.log('✅ Bucket updated successfully!');
    console.log('Configuration:');
    console.log('  - Max file size: 5MB');
    console.log('  - Allowed types: JPEG, JPG, PNG, WebP');
    console.log('  - Public: No (private bucket)');
  }

  // Test with an actual image upload
  console.log('\n📤 Testing image upload...');

  // Create a minimal valid PNG (1x1 transparent pixel)
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, // IEND chunk
    0x42, 0x60, 0x82
  ]);

  const testPath = 'licenses/test_image.png';

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('license-images-temp')
    .upload(testPath, pngBuffer, {
      contentType: 'image/png',
      upsert: true
    });

  if (uploadError) {
    console.error('❌ Upload error:', uploadError);
    console.error('Error details:', JSON.stringify(uploadError, null, 2));
  } else {
    console.log('✅ Image upload successful!');
    console.log('Path:', uploadData.path);

    // Clean up test file
    const { error: deleteError } = await supabase.storage
      .from('license-images-temp')
      .remove([testPath]);

    if (deleteError) {
      console.warn('⚠️ Could not clean up test file:', deleteError);
    } else {
      console.log('✅ Test file cleaned up');
    }
  }

  console.log('\n✨ Setup complete! You can now upload license images.');
}

fixBucket().catch(console.error);
