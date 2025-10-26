const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkUser() {
  const email = 'countluigivampa@gmail.com';

  console.log(`Checking user: ${email}\n`);

  // Get user from auth
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

  if (authError) {
    console.error('Auth error:', authError);
    return;
  }

  const user = users?.find(u => u.email === email);

  if (!user) {
    console.log('❌ User NOT found in auth.users');
    console.log('This is a NEW user - they need to SIGN UP first, not login');
    console.log('\nMagic links only work for EXISTING users.');
    console.log('New users should use /alerts/signup');
    return;
  }

  console.log('✓ User EXISTS in auth.users');
  console.log('  ID:', user.id);
  console.log('  Email:', user.email);
  console.log('  Created:', user.created_at);
  console.log('  Last sign in:', user.last_sign_in_at || 'Never');
  console.log('  Email confirmed:', user.email_confirmed_at ? 'Yes' : 'No');

  // Check users table
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (userData) {
    console.log('\n✓ Profile exists in users table');
    console.log('  Phone:', userData.phone);
    console.log('  Name:', userData.first_name, userData.last_name);
  } else {
    console.log('\n❌ No profile in users table');
  }
}

checkUser().catch(console.error);
