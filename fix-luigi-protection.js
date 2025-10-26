const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function fixProtection() {
  const userId = '4bf55942-4c71-4ba9-80ee-c89b7e384fdb';

  console.log('Updating user_profiles with Protection status and address...');
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update({
      has_protection: true,
      mailing_address: '1710 S Clinton St',
      street_address: '1710 S Clinton St',
      home_address_full: '1710 S Clinton St',
      has_permit_zone: true,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select();

  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log('✅ Profile updated successfully!');
    console.log('\nUpdated profile:');
    console.log('  Has Protection:', data[0].has_protection);
    console.log('  Street Address:', data[0].street_address);
    console.log('  Has Permit Zone:', data[0].has_permit_zone);
  }
}

fixProtection().catch(console.error);
