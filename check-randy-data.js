const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkRandyData() {
  console.log('🔍 Checking Randy\'s data in both tables...');
  
  // Check user_profiles table
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  if (profileError) {
    console.log('❌ Error accessing user_profiles:', profileError.message);
  } else if (profile) {
    console.log('✅ Found in user_profiles table:');
    console.log('  User ID:', profile.user_id);
    console.log('  First Name:', profile.first_name);
    console.log('  Last Name:', profile.last_name);
    console.log('  Phone:', profile.phone_number);
    console.log('  License Plate:', profile.license_plate);
    console.log('  City Sticker Expiry:', profile.city_sticker_expiry);
    console.log('  Vehicle Type:', profile.vehicle_type);
    console.log('  VIN:', profile.vin);
    console.log('  Mailing Address:', profile.mailing_address);
    console.log('  Updated At:', profile.updated_at);
  } else {
    console.log('⚠️ No profile found in user_profiles table');
  }
  
  // Check users table
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  if (userError) {
    console.log('❌ Error accessing users table:', userError.message);
  } else if (user) {
    console.log('\n✅ Found in users table:');
    console.log('  ID:', user.id);
    console.log('  First Name:', user.first_name);
    console.log('  Last Name:', user.last_name);
    console.log('  Phone:', user.phone);
    console.log('  License Plate:', user.license_plate);
    console.log('  City Sticker Expiry:', user.city_sticker_expiry);
    console.log('  Vehicle Type:', user.vehicle_type);
    console.log('  VIN:', user.vin);
    console.log('  Mailing Address:', user.mailing_address);
    console.log('  Updated At:', user.updated_at);
  } else {
    console.log('\n⚠️ No user found in users table');
  }
}

checkRandyData();