require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSecurity() {
  const buckets = ['license-images-temp', 'residency-proofs-temps', 'ticket-photos'];

  for (const bucket of buckets) {
    console.log(`\n📦 Bucket: ${bucket}`);
    const { data, error } = await supabase.storage.getBucket(bucket);
    if (error) {
      console.log('  ❌ Error:', error.message);
    } else if (data) {
      console.log('  Public:', data.public ? '❌ YES (DANGER!)' : '✅ NO (Good)');
      console.log('  File size limit:', data.file_size_limit ? `${data.file_size_limit / 1024 / 1024}MB` : '⚠️  None set');
      console.log('  Allowed MIME types:', data.allowed_mime_types?.length ? data.allowed_mime_types.join(', ') : '⚠️  All allowed');
    }
  }

  console.log('\n\n🔒 SECURITY RECOMMENDATIONS:\n');
  console.log('✅ All buckets should be PRIVATE (public: false)');
  console.log('✅ Set file size limits (5MB for licenses, 10MB for bills)');
  console.log('✅ Restrict MIME types (image/* for licenses, application/pdf for bills)');
  console.log('✅ Enable RLS (Row Level Security) policies');
}

checkSecurity().catch(console.error);
