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

async function checkAccount() {
  const email = 'countluigivampa@gmail.com';

  console.log('Checking auth users...');
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const authUsers = users.filter(u => u.email === email);
  
  console.log('\n📧 Auth Users:', authUsers.length);
  authUsers.forEach((user, i) => {
    console.log(`\nUser ${i + 1}:`);
    console.log('  ID:', user.id);
    console.log('  Email:', user.email);
    console.log('  Confirmed:', user.email_confirmed_at ? 'Yes' : 'No');
    console.log('  Created:', user.created_at);
    console.log('  Providers:', user.app_metadata?.providers || user.identities?.map(id => id.provider));
  });

  console.log('\n\nChecking user_profiles...');
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('email', email);

  if (profileError) {
    console.error('Error:', profileError);
  } else {
    console.log('Profiles found:', profiles?.length || 0);
    profiles?.forEach((profile, i) => {
      console.log(`\nProfile ${i + 1}:`);
      console.log('  User ID:', profile.user_id);
      console.log('  Has Protection:', profile.has_protection);
      console.log('  License Plate:', profile.license_plate);
      console.log('  Phone:', profile.phone_number);
      console.log('  Address:', profile.mailing_address);
      console.log('  City Sticker Expiry:', profile.city_sticker_expiry);
      console.log('  License Plate Expiry:', profile.license_plate_expiry);
    });
  }
}

checkAccount().catch(console.error);
