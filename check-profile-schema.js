const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  console.log('\n🔍 Checking user_profiles schema and Luigi\'s actual data...\n');

  // Get Luigi's profile with ONLY address fields
  const { data, error } = await supabase
    .from('user_profiles')
    .select('email, home_address_full, mailing_address, mailing_city, mailing_state, mailing_zip, updated_at, created_at')
    .eq('email', 'countluigivampa@gmail.com')
    .single();

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('📋 Luigi\'s Profile Address Fields:');
  console.log(JSON.stringify(data, null, 2));

  // Now test creating a fresh account to see if mailing address gets saved
  console.log('\n\n🧪 Testing /api/alerts/create to verify mailing address logic...\n');

  const testEmail = `test-mailing-${Date.now()}@test.com`;
  const testData = {
    firstName: 'Test',
    lastName: 'User',
    email: testEmail,
    phone: '2245678901',
    licensePlate: 'TEST123',
    address: '123 Test Street',
    zip: '60614'
  };

  console.log('Creating test account with address:', testData.address);

  const response = await fetch('https://ticketlessamerica.com/api/alerts/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testData)
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('❌ API call failed:', result);
    return;
  }

  console.log('✅ Account created\n');

  // Check what was actually saved
  const { data: testProfile, error: testError } = await supabase
    .from('user_profiles')
    .select('email, home_address_full, mailing_address, mailing_city, mailing_state, mailing_zip')
    .eq('email', testEmail)
    .single();

  if (testError) {
    console.error('❌ Error fetching test profile:', testError.message);
    return;
  }

  console.log('📋 Test Profile Saved As:');
  console.log(JSON.stringify(testProfile, null, 2));

  if (testProfile.mailing_address === testData.address) {
    console.log('\n✅✅✅ MAILING ADDRESS SAVED CORRECTLY');
  } else {
    console.log('\n❌❌❌ MAILING ADDRESS NOT SAVED!');
    console.log('Expected:', testData.address);
    console.log('Got:', testProfile.mailing_address);
  }

  // Clean up
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const testUser = authUsers?.users.find(u => u.email === testEmail);
  if (testUser) {
    await supabase.auth.admin.deleteUser(testUser.id);
    await supabase.from('user_profiles').delete().eq('email', testEmail);
    await supabase.from('users').delete().eq('email', testEmail);
    await supabase.from('vehicles').delete().eq('user_id', testUser.id);
    console.log('\n🗑️  Test account cleaned up');
  }
}

checkSchema();
