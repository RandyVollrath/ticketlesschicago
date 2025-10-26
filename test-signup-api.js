const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSignup() {
  const testEmail = `test-${Date.now()}@test.com`;

  console.log('\n🧪 Testing /api/alerts/create with test data...\n');

  const formData = {
    firstName: 'Test',
    lastName: 'User',
    email: testEmail,
    phone: '2245678901',
    licensePlate: 'TEST123',
    address: '1350 W Kenmore Ave',
    zip: '60614'
  };

  // Call the API
  const response = await fetch('http://localhost:3000/api/alerts/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('❌ API call failed:', result);
    return;
  }

  console.log('✅ API call succeeded, checking database...\n');

  // Check what was saved
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, home_address_full, mailing_address, mailing_city, mailing_state, mailing_zip')
    .eq('email', testEmail)
    .single();

  if (!profile) {
    console.error('❌ Profile not found');
    return;
  }

  console.log('📋 Saved profile data:');
  console.log('  Email:', profile.email);
  console.log('  Home Address:', profile.home_address_full);
  console.log('  Mailing Address:', profile.mailing_address);
  console.log('  Mailing City:', profile.mailing_city);
  console.log('  Mailing State:', profile.mailing_state);
  console.log('  Mailing ZIP:', profile.mailing_zip);

  if (profile.mailing_address === formData.address) {
    console.log('\n✅ Mailing address correctly saved!');
  } else {
    console.log('\n❌ Mailing address NOT saved correctly!');
    console.log('   Expected:', formData.address);
    console.log('   Got:', profile.mailing_address);
  }

  // Clean up
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const testUser = authUsers?.users.find(u => u.email === testEmail);
  if (testUser) {
    await supabase.auth.admin.deleteUser(testUser.id);
    await supabase.from('user_profiles').delete().eq('email', testEmail);
    await supabase.from('users').delete().eq('email', testEmail);
    console.log('\n🗑️  Cleaned up test data');
  }
}

testSignup();
