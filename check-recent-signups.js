const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkRecentSignups() {
  const emails = [
    'thechicagoapp@gmail.com',
    'mystreetcleaning@gmail.com'
  ];

  console.log('Checking recent signups...\n');

  for (const email of emails) {
    console.log(`\n=== ${email} ===`);

    // Get user from auth
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      console.error('Auth error:', authError);
      continue;
    }

    const user = users?.find(u => u.email === email);

    if (!user) {
      console.log('❌ NOT found in auth.users');
      continue;
    }

    console.log('✓ Found in auth.users');
    console.log('  ID:', user.id);
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
      console.log('  ✓ Profile exists');
      console.log('  Phone:', userData.phone);
    } else {
      console.log('  ❌ No profile');
    }
  }
}

checkRecentSignups().catch(console.error);
