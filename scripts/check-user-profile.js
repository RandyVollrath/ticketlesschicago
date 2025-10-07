require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkUserProfile(email) {
  console.log(`\n🔍 Checking profile for: ${email}\n`);

  // Get user profile
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return;
  }

  if (!profile) {
    console.log('❌ No profile found');
    return;
  }

  console.log('✅ Profile found:\n');
  console.log('User ID:', profile.user_id);
  console.log('Email:', profile.email);
  console.log('Phone:', profile.phone || profile.phone_number || 'Not set');
  console.log('\n📍 Address:');
  console.log('  Full address:', profile.home_address_full || 'Not set');
  console.log('  Street:', profile.home_address_street || 'Not set');
  console.log('  Ward:', profile.home_address_ward || 'Not set');
  console.log('  Section:', profile.home_address_section || 'Not set');
  console.log('\n🔔 Notification Settings:');
  console.log('  SMS enabled:', profile.notify_sms);
  console.log('  Email enabled:', profile.notify_email);
  console.log('  Evening before:', profile.notify_evening_before);
  console.log('  Follow-up SMS:', profile.follow_up_sms);
  console.log('  Notify days:', profile.notify_days_array || [0]);
  console.log('\n🛡️ Protection:');
  console.log('  Has protection:', profile.has_protection);
  console.log('  City sticker expiry:', profile.city_sticker_expiry || 'Not set');
  console.log('  License plate expiry:', profile.license_plate_expiry || 'Not set');
  console.log('\n🐦 Special:');
  console.log('  Is canary:', profile.is_canary || false);
}

const email = process.argv[2] || 'heyliberalname@gmail.com';
checkUserProfile(email);
