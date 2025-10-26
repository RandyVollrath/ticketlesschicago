const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkPendingSignup() {
  const email = 'hellodolldarlings@gmail.com';

  console.log(`Checking for pending signup: ${email}\n`);

  // Check pending_signups table
  const { data, error } = await supabase
    .from('pending_signups')
    .select('*')
    .eq('email', email);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (data && data.length > 0) {
    console.log('✓ Found pending signup(s):');
    data.forEach((signup, i) => {
      console.log(`\n  Signup ${i + 1}:`);
      console.log('  Email:', signup.email);
      console.log('  Created:', signup.created_at);
      console.log('  Has data:', !!signup.form_data);
    });

    console.log('\n⚠️  This is causing the redirect to /alerts/signup');
    console.log('   Deleting pending signups...\n');

    // Delete them
    const { error: deleteError } = await supabase
      .from('pending_signups')
      .delete()
      .eq('email', email);

    if (deleteError) {
      console.error('Error deleting:', deleteError);
    } else {
      console.log('✅ Deleted pending signups. Magic links should now work correctly.');
    }
  } else {
    console.log('❌ No pending signups found');
    console.log('   Magic links should work correctly');
  }
}

checkPendingSignup().catch(console.error);
