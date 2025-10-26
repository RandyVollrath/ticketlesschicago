const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testNewSMTP() {
  const email = 'hellodolldarlings@gmail.com';
  const timestamp = new Date().toLocaleTimeString();

  console.log(`[${timestamp}] Sending test magic link to: ${email}`);
  console.log('With new SMTP settings (Resend via autopilotamerica.com)\n');

  const { data, error } = await supabase.auth.signInWithOtp({
    email: email,
    options: {
      emailRedirectTo: 'https://autopilotamerica.com/alerts/signup'
    }
  });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  const sentTime = new Date().toLocaleTimeString();
  console.log(`✓ Magic link request sent at: ${sentTime}`);
  console.log('\n📧 Check email for:');
  console.log('   From: noreply@autopilotamerica.com');
  console.log('   Name: Autopilot America');
  console.log('   Subject: Confirm your signup\n');
  console.log('⏱️  Note the arrival time to check for delays');
}

testNewSMTP().catch(console.error);
