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

  console.log(`Checking users table for: ${email}\n`);

  // Check users table
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error) {
    console.error('Error querying users table:', error);
    return;
  }

  if (user) {
    console.log('✓ Found in users table:');
    console.log(JSON.stringify(user, null, 2));
  } else {
    console.log('❌ Not found in users table');
    console.log('\nThis means the handle_new_user() trigger did not fire!');
  }

  // Also check profiles table
  const { data: profile, error: profError } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (profile) {
    console.log('\n✓ Found in profiles table:');
    console.log(JSON.stringify(profile, null, 2));
  } else {
    console.log('\n❌ Not found in profiles table');
  }
}

checkUser().catch(console.error);
