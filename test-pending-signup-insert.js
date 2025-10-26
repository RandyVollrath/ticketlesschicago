const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Use anon key like the frontend does
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function testInsert() {
  console.log('\n🧪 Testing pending_signups insert with anon key...\n');

  const testEmail = `test-${Date.now()}@test.com`;

  const { data, error } = await supabase
    .from('pending_signups')
    .upsert({
      email: testEmail,
      first_name: 'Test',
      last_name: 'User',
      phone: '1234567890',
      license_plate: 'TEST123',
      address: '123 Main St',
      zip: '60614',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }, {
      onConflict: 'email'
    })
    .select();

  if (error) {
    console.error('❌ Insert failed:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details);
    return;
  }

  console.log('✅ Insert succeeded!');
  console.log('   Email:', testEmail);

  // Clean up
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  await supabaseAdmin.from('pending_signups').delete().eq('email', testEmail);
  console.log('🗑️  Cleaned up test data');
}

testInsert();
