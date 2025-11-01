const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUserData() {
  const email = 'hiautopilotamerica+1@gmail.com';
  
  try {
    console.log('🔍 Checking data for:', email);
    
    // 1. Check auth user
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const user = authUsers.users.find(u => u.email === email);
    
    if (!user) {
      console.log('❌ User not found in auth.users');
      return;
    }
    
    console.log('\n✅ Auth User Found:');
    console.log('  User ID:', user.id);
    console.log('  Email:', user.email);
    console.log('  Created:', user.created_at);
    console.log('  Email confirmed:', user.email_confirmed_at ? 'Yes' : 'No');
    
    // 2. Check user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    console.log('\n📋 User Profile:');
    if (profileError) {
      console.log('  ❌ Error:', profileError.message);
    } else if (profile) {
      console.log('  License Plate:', profile.license_plate || 'NULL');
      console.log('  Home Address:', profile.home_address_full || 'NULL');
      console.log('  ZIP Code:', profile.zip_code || 'NULL');
      console.log('  Phone:', profile.phone_number || 'NULL');
      console.log('  First Name:', profile.first_name || 'NULL');
      console.log('  Last Name:', profile.last_name || 'NULL');
    } else {
      console.log('  ❌ No profile found');
    }
    
    // 3. Check vehicles table
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', user.id);
    
    console.log('\n🚗 Vehicles:');
    if (vehiclesError) {
      console.log('  ❌ Error:', vehiclesError.message);
    } else if (vehicles && vehicles.length > 0) {
      vehicles.forEach((v, idx) => {
        console.log('  Vehicle ' + (idx + 1) + ':');
        console.log('    License Plate:', v.license_plate);
        console.log('    VIN:', v.vin || 'NULL');
        console.log('    Make/Model:', v.make || 'NULL', '/', v.model || 'NULL');
      });
    } else {
      console.log('  ❌ No vehicles found');
    }
    
    // 4. Check passkeys
    console.log('\n🔐 Checking passkeys...');
    const identities = user.identities || [];
    console.log('  Identities:', identities.map(i => i.provider).join(', ') || 'None');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkUserData();
