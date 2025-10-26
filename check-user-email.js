const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkUser() {
  const email = 'hellodolldarlings@gmail.com';

  console.log(`Checking for user: ${email}`);
  console.log(`Supabase URL: ${supabaseUrl}\n`);

  // Get user from auth
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

  if (authError) {
    console.error('Auth error:', authError);
    return;
  }

  const user = users?.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found in auth.users');
    console.log('\nThis means:');
    console.log('1. The signup never completed');
    console.log('2. Or the email was never sent');
    console.log('3. Or there was an error during signup\n');
    return;
  }

  console.log('✓ Found user:', user.id);
  console.log('Email:', user.email);
  console.log('Email confirmed:', user.email_confirmed_at ? 'Yes' : 'No');
  console.log('Created:', user.created_at);
  console.log('Last sign in:', user.last_sign_in_at || 'Never');

  // Check if user has confirmed their email
  if (!user.email_confirmed_at) {
    console.log('\n⚠️  Email NOT confirmed - user needs to click magic link');
  }

  // Check profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile) {
    console.log('\n✓ Profile exists');
    console.log('Phone:', profile.phone || 'None');
    console.log('Has Protection:', profile.has_protection);
  } else {
    console.log('\n❌ No profile found');
  }

  // Check for alerts subscriptions
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id);

  if (subscriptions?.length) {
    console.log(`\n✓ Alert subscriptions: ${subscriptions.length}`);
  }
}

checkUser().catch(console.error);
