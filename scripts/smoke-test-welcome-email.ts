require('dotenv').config({ path: '.env.local' });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendWelcomeEmailOnce } = require('../lib/welcome-email');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const TO = process.argv[2] || 'randyvollrath@gmail.com';
  const FORCE = process.argv.includes('--force');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, first_name, email')
    .eq('email', TO)
    .maybeSingle();

  if (!profile) {
    console.error(`No user_profile row for ${TO} — using a synthetic user id.`);
  }

  const PLACEHOLDER_UUID = ['00000000', '0000', '0000', '0000', '000000000000'].join('-');
  const userId = profile?.user_id || PLACEHOLDER_UUID;
  const firstName = profile?.first_name || 'Randy';

  if (FORCE && profile?.user_id) {
    // Clear welcome_email_sent_at so we can re-send
    try {
      await (supabase.from('user_profiles').update({ welcome_email_sent_at: null } as any).eq('user_id', userId) as any);
      console.log('[smoke] cleared welcome_email_sent_at for force-send');
    } catch (e) {
      console.warn('[smoke] could not clear column (probably not migrated yet):', e);
    }
  }

  console.log(`[smoke] sending welcome to ${TO} (user=${userId.slice(0, 8)}…)…`);
  const result = await sendWelcomeEmailOnce({
    userId,
    email: TO,
    firstName,
    planLabel: 'Autopilot (Annual) — SMOKE TEST',
    magicLink: null,
    source: 'stripe',
  });
  console.log('[smoke] result:', result);
  if (!result.sent && result.reason !== 'already_sent') {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
