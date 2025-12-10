#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBuckets() {
  console.log('🪣 Checking Supabase Storage buckets...\n');
  
  const { data: buckets, error } = await supabase.storage.listBuckets();
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log(`Found ${buckets.length} buckets:\n`);
  buckets.forEach((bucket, i) => {
    console.log(`${i + 1}. ${bucket.name}`);
    console.log(`   ID: ${bucket.id}`);
    console.log(`   Public: ${bucket.public}`);
    console.log(`   Created: ${bucket.created_at}`);
    console.log('');
  });
  
  // Check for residency-related buckets
  const residencyBuckets = buckets.filter(b => b.name.includes('residency'));
  console.log(`\n📋 Residency-related buckets: ${residencyBuckets.length}`);
  residencyBuckets.forEach(b => console.log(`   - ${b.name}`));
}

checkBuckets().catch(console.error);
