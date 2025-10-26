const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixMailing() {
  console.log('\n🔧 Fixing mailing address for countluigivampa@gmail.com...\n');

  // Get current profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, home_address_full, zip_code')
    .eq('email', 'countluigivampa@gmail.com')
    .single();

  if (!profile) {
    console.error('❌ Profile not found');
    return;
  }

  console.log('Current data:');
  console.log('  Home address:', profile.home_address_full);
  console.log('  ZIP:', profile.zip_code);

  if (!profile.home_address_full) {
    console.error('❌ No home address to copy');
    return;
  }

  // Update mailing address to match home address
  const { error } = await supabase
    .from('user_profiles')
    .update({
      mailing_address: profile.home_address_full,
      mailing_city: 'Chicago',
      mailing_state: 'IL',
      mailing_zip: profile.zip_code,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', profile.user_id);

  if (error) {
    console.error('❌ Update failed:', error.message);
    return;
  }

  console.log('\n✅ Updated mailing address to match home address');
  console.log('  Mailing address:', profile.home_address_full);
  console.log('  Mailing city: Chicago');
  console.log('  Mailing state: IL');
  console.log('  Mailing ZIP:', profile.zip_code);
}

fixMailing();
