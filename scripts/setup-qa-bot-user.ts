#!/usr/bin/env npx tsx
/**
 * One-time setup: create the QA bot user in Supabase.
 *
 * The auth smoke test (scripts/qa-auth-smoke.ts) signs in as this bot
 * every 30 minutes via admin-generated magic link to verify the whole
 * auth round-trip still works in prod. This script creates that bot.
 *
 * Run once locally:
 *   node -r dotenv/config node_modules/.bin/tsx scripts/setup-qa-bot-user.ts dotenv_config_path=.env.local
 *
 * Idempotent: if the bot already exists it just prints the user ID.
 *
 * After running, the bot user ID shows up in user_profiles / auth.users
 * with app_metadata.qa_bot = true so downstream crons and analytics can
 * filter it out.
 */

import { createClient } from '@supabase/supabase-js';

const BOT_EMAIL = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.error('Load .env.local first, e.g.:');
    console.error('  node -r dotenv/config node_modules/.bin/tsx scripts/setup-qa-bot-user.ts dotenv_config_path=.env.local');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Paginate just in case; listUsers defaults to 50/page.
  let found: any = null;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`❌ listUsers failed: ${error.message}`);
      process.exit(1);
    }
    found = data.users.find(u => u.email === BOT_EMAIL);
    if (found) break;
    if (data.users.length < 200) break;
    page += 1;
  }

  if (found) {
    console.log(`✓ QA bot already exists`);
    console.log(`   id:    ${found.id}`);
    console.log(`   email: ${found.email}`);
    console.log(`   qa_bot flag: ${JSON.stringify(found.app_metadata?.qa_bot ?? null)}`);
    if (!found.app_metadata?.qa_bot) {
      console.log(`→ Adding app_metadata.qa_bot = true ...`);
      const { error } = await supabase.auth.admin.updateUserById(found.id, {
        app_metadata: { ...(found.app_metadata || {}), qa_bot: true },
      });
      if (error) {
        console.error(`   updateUserById failed: ${error.message}`);
        process.exit(1);
      }
      console.log(`   ✓ flag set`);
    }
    return;
  }

  console.log(`→ Creating ${BOT_EMAIL} ...`);
  const { data, error } = await supabase.auth.admin.createUser({
    email: BOT_EMAIL,
    email_confirm: true,
    app_metadata: { qa_bot: true },
    user_metadata: { full_name: 'QA Bot' },
  });
  if (error || !data.user) {
    console.error(`❌ createUser failed: ${error?.message || 'no user in response'}`);
    process.exit(1);
  }

  console.log(`✓ Created QA bot user`);
  console.log(`   id:    ${data.user.id}`);
  console.log(`   email: ${data.user.email}`);
  console.log('');
  console.log('Next: add these to GitHub repo secrets (Settings → Secrets and variables → Actions):');
  console.log('   NEXT_PUBLIC_SUPABASE_URL     = https://auth.autopilotamerica.com');
  console.log('   SUPABASE_SERVICE_ROLE_KEY    = (same as prod/.env.local)');
  console.log(`   QA_BOT_EMAIL                 = ${BOT_EMAIL}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
