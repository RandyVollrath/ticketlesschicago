/**
 * Check if residency-proofs-temp bucket exists in Supabase storage
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBucket() {
  console.log('Checking Supabase storage buckets...\n');

  const { data, error } = await supabase.storage.listBuckets();

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log('📦 Available buckets:');
  data.forEach(bucket => {
    console.log(`  - ${bucket.name}`);
  });

  const hasResidencyBucket = data.find(b => b.name === 'residency-proofs-temp');

  console.log('');
  if (hasResidencyBucket) {
    console.log('✅ residency-proofs-temp bucket exists!');
  } else {
    console.log('❌ residency-proofs-temp bucket NOT found');
    console.log('\nYou need to create it in Supabase dashboard:');
    console.log('1. Go to: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/storage/buckets');
    console.log('2. Click "New bucket"');
    console.log('3. Name: residency-proofs-temp');
    console.log('4. Public: NO (keep private)');
    console.log('5. Click "Create bucket"');
  }
}

checkBucket().catch(console.error);
