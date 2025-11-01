require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  const email = 'countluigivampa+1@gmail.com';

  console.log(`🔍 Checking user: ${email}\n`);

  // Check auth users
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found in auth.users');
    return;
  }

  console.log('✅ User found in auth.users:');
  console.log('   User ID:', user.id);
  console.log('   Email:', user.email);
  console.log('   Email verified:', user.email_confirmed_at ? 'Yes' : 'No');
  console.log('   Created:', user.created_at);
  console.log('   Last sign in:', user.last_sign_in_at || 'Never');
  console.log('   Identities:', user.identities?.map(i => i.provider).join(', '));

  // Check user profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (profile) {
    console.log('\n✅ User profile found:');
    console.log('   First name:', profile.first_name);
    console.log('   Has protection:', profile.has_protection);
    console.log('   Email verified (profile):', profile.email_verified);
  } else {
    console.log('\n❌ No user profile found');
  }
}

checkUser()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
