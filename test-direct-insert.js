#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testDirectly() {
  console.log('🔍 Testing direct database access...\n');

  // Try to insert directly
  console.log('Attempting to insert into court_case_outcomes...');
  const { data, error } = await supabase
    .from('court_case_outcomes')
    .insert({
      violation_code: 'TEST-001',
      ticket_amount: 50.00,
      outcome: 'dismissed'
    })
    .select()
    .single();

  if (error) {
    console.log('❌ Error:', error.message);
    console.log('Full error:', JSON.stringify(error, null, 2));

    if (error.message.includes('schema cache')) {
      console.log('\n💡 Solution: The table exists but Supabase needs to refresh its schema cache.');
      console.log('   Try these steps:');
      console.log('   1. Wait 30-60 seconds for cache to refresh');
      console.log('   2. Or restart your Supabase project (Settings → General → Restart)');
      console.log('   3. Then run this script again');
    }
  } else {
    console.log('✅ Success! Data inserted:', data);
    console.log('\nNow deleting test data...');

    await supabase
      .from('court_case_outcomes')
      .delete()
      .eq('id', data.id);

    console.log('✅ Test data cleaned up');
    console.log('\n🎉 Everything is working! You can now run: node seed-sample-data.js');
  }
}

testDirectly().catch(console.error);
