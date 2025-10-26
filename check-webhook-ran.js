const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWebhook(email) {
  console.log(`\n🔍 Checking if webhook ran for: ${email}\n`);

  // Check if user exists
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const user = authUsers?.users?.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found in auth.users - webhook likely did not run');
    return;
  }

  console.log('✅ User found in auth:', user.id);

  // Check profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (!profile) {
    console.log('❌ No profile found - webhook may have failed after user creation');
    return;
  }

  console.log('\n📋 Profile status:');
  console.log('  has_protection:', profile.has_protection);
  console.log('  phone:', profile.phone_number);
  console.log('  address:', profile.mailing_address);
  console.log('  created_at:', profile.created_at);

  if (profile.has_protection) {
    console.log('\n✅ Webhook ran successfully (has_protection = true)');
    console.log('⚠️  But magic link email may have failed to send via Resend');
  } else {
    console.log('\n❌ Webhook did not complete (has_protection = false)');
  }
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node check-webhook-ran.js EMAIL');
  process.exit(1);
}

checkWebhook(email);
