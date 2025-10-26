const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function sendMagicLink() {
  const email = 'hellodolldarlings@gmail.com';

  console.log(`Sending new magic link to: ${email}`);

  const { data, error } = await supabase.auth.signInWithOtp({
    email: email,
    options: {
      emailRedirectTo: 'https://autopilotamerica.com/alerts/signup'
    }
  });

  if (error) {
    console.error('Error sending magic link:', error);
    return;
  }

  console.log('✓ Magic link sent successfully!');
  console.log('\nCheck:');
  console.log('1. Inbox for hellodolldarlings@gmail.com');
  console.log('2. Spam/Junk folder');
  console.log('3. Promotions tab (if Gmail)');
  console.log('\nEmail should come from Supabase (not autopilotamerica.com)');
}

sendMagicLink().catch(console.error);
