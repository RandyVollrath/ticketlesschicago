#!/usr/bin/env tsx
/**
 * Backfill public.users rows for user_profiles rows that have no matching users row.
 * For profiles with null email, fall back to auth.users email.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
const supa = createClient(url, key);

const APPLY = process.argv.includes('--apply');

async function main() {
  const { data: profiles } = await supa
    .from('user_profiles')
    .select('user_id, email, home_address_ward, home_address_section, notify_sms, follow_up_sms, created_at');
  const { data: users } = await supa.from('users').select('id');
  const userIds = new Set((users || []).map(u => u.id));

  const orphans = (profiles || []).filter(p => p.user_id && !userIds.has(p.user_id));
  const atRisk = orphans.filter(o => o.home_address_ward && (o.notify_sms || o.follow_up_sms));
  console.log(`${orphans.length} orphans, ${atRisk.length} at risk of duplicate SMS (have ward + sms enabled).`);
  console.log('Sample orphan rows:');
  for (const o of orphans.slice(0, 10)) console.log(' ', o.user_id, o.email, 'ward:', o.home_address_ward);

  if (!APPLY) {
    console.log('Dry run — pass --apply to insert.');
    return;
  }

  let ok = 0, fail = 0;
  for (const o of orphans) {
    let email = o.email;
    if (!email) {
      const { data: authRes } = await supa.auth.admin.getUserById(o.user_id);
      email = authRes?.user?.email || null;
    }
    if (!email) {
      console.log(`  skip ${o.user_id}: no email in profile or auth`);
      continue;
    }

    let attemptEmail = email;
    let { error } = await supa
      .from('users')
      .insert({ id: o.user_id, email: attemptEmail, created_at: o.created_at } as any);
    if (error && error.code === '23505') {
      // Email uniqueness collision — suffix with user_id short form
      attemptEmail = `${email.split('@')[0]}+profile-${o.user_id.slice(0, 8)}@${email.split('@')[1]}`;
      const retry = await supa
        .from('users')
        .insert({ id: o.user_id, email: attemptEmail, created_at: o.created_at } as any);
      error = retry.error;
      if (!error) console.log(`  collision resolved with suffixed email for ${email} -> ${attemptEmail}`);
    }
    if (error) {
      console.error(`  FAIL ${email}: ${error.message}`);
      fail++;
    } else {
      ok++;
    }
  }
  console.log(`\nDone. inserted=${ok} failed=${fail}`);
}
main().catch(e => { console.error(e); process.exit(1); });
