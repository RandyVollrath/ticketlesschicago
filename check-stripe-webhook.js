const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWebhook(email) {
  console.log(`\n🔍 Checking Stripe webhook status for: ${email}\n`);

  // Get user
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, has_protection')
    .eq('email', email)
    .single();

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!profile) {
    console.log('❌ Profile not found');
    return;
  }

  console.log('📋 Profile Status:');
  console.log('  User ID:', profile.user_id);
  console.log('  Has Protection:', profile.has_protection || false);

  if (!profile.has_protection) {
    console.log('\n⚠️  WEBHOOK DID NOT RUN OR FAILED');
    console.log('   Protection flag is not set');
    console.log('\n   Possible causes:');
    console.log('   1. Webhook failed');
    console.log('   2. Webhook not triggered');
    console.log('   3. Payment still processing');
    console.log('   4. Test mode checkout (no real payment)');
  } else {
    console.log('\n✅ Protection is active - webhook ran successfully');
  }
}

const email = process.argv[2] || 'hellosexdollnow@gmail.com';
checkWebhook(email);
