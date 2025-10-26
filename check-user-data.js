const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser(email) {
  console.log(`\n🔍 Checking data for: ${email}\n`);

  // Check auth.users
  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
  const authUser = authUsers?.users.find(u => u.email === email);

  console.log('=== AUTH USER ===');
  if (authUser) {
    console.log('✅ Exists in auth.users');
    console.log('  ID:', authUser.id);
    console.log('  Email:', authUser.email);
    console.log('  Created:', authUser.created_at);
    console.log('  Metadata:', JSON.stringify(authUser.user_metadata, null, 2));
  } else {
    console.log('❌ NOT found in auth.users');
  }

  // Check users table
  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('*')
    .eq('email', email);

  console.log('\n=== USERS TABLE ===');
  if (usersError) {
    console.log('❌ Error:', usersError.message);
  } else if (usersData && usersData.length > 0) {
    console.log('✅ Exists in users table');
    console.log(JSON.stringify(usersData[0], null, 2));
  } else {
    console.log('❌ NOT found in users table');
  }

  // Check user_profiles table
  const { data: profilesData, error: profilesError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email);

  console.log('\n=== USER_PROFILES TABLE ===');
  if (profilesError) {
    console.log('❌ Error:', profilesError.message);
  } else if (profilesData && profilesData.length > 0) {
    console.log('✅ Exists in user_profiles table');
    console.log(JSON.stringify(profilesData[0], null, 2));
  } else {
    console.log('❌ NOT found in user_profiles table');
  }

  // Check vehicles table
  if (authUser) {
    const { data: vehiclesData, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', authUser.id);

    console.log('\n=== VEHICLES TABLE ===');
    if (vehiclesError) {
      console.log('❌ Error:', vehiclesError.message);
    } else if (vehiclesData && vehiclesData.length > 0) {
      console.log('✅ Has vehicles:', vehiclesData.length);
      vehiclesData.forEach((v, i) => {
        console.log(`  Vehicle ${i + 1}:`, v.license_plate, v.make, v.model);
      });
    } else {
      console.log('❌ NO vehicles found');
    }
  }
}

const email = process.argv[2] || 'countluigivampa@gmail.com';
checkUser(email);
