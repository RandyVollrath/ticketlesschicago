/**
 * Verifies a partner comp-signup created the right DB state:
 * - auth.users row
 * - user_profiles with is_paid=true, has_contesting=true
 * - autopilot_subscriptions row, status=active, plan_code=COMP_PARTNER, price_cents=0
 * - monitored_plates row, status=active
 * - audit_logs entry
 *
 * Usage: npx tsx scripts/smoke-test-partner-signup.ts <email>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx scripts/smoke-test-partner-signup.ts <email>');
    process.exit(1);
  }

  let ok = true;
  const fail = (msg: string) => {
    ok = false;
    console.log(`  ❌ ${msg}`);
  };
  const pass = (msg: string) => console.log(`  ✅ ${msg}`);

  console.log(`Verifying partner signup for ${email}\n`);

  // 1) Auth user
  let userId: string | null = null;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) { userId = hit.id; break; }
    if (data.users.length < 1000) break;
    page += 1;
  }

  if (!userId) {
    fail('auth.users: not found');
    process.exit(1);
  }
  pass(`auth.users found: ${userId}`);

  // 2) user_profiles
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id,email,is_paid,has_contesting,license_plate,license_state,mailing_address,mailing_city,mailing_state,mailing_zip,affiliate_id,first_name,last_name,vehicle_make,vehicle_model')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile) {
    fail('user_profiles: missing');
  } else {
    pass(`user_profiles: ${profile.first_name} ${profile.last_name}, plate ${profile.license_plate}/${profile.license_state}`);
    if (!(profile as any).is_paid) fail('user_profiles.is_paid is not true');
    else pass('is_paid=true');
    if (!(profile as any).has_contesting) fail('user_profiles.has_contesting is not true');
    else pass('has_contesting=true');
    if (!(profile as any).mailing_address) fail('mailing_address blank');
    else pass(`mailing_address: ${(profile as any).mailing_address}, ${(profile as any).mailing_city}, ${(profile as any).mailing_state} ${(profile as any).mailing_zip}`);
    if ((profile as any).affiliate_id) pass(`affiliate_id: ${(profile as any).affiliate_id}`);
    else console.log('  ⚠️  affiliate_id missing (Rewardful disabled or failed?)');
  }

  // 3) autopilot_subscriptions
  const { data: subs } = await supabase
    .from('autopilot_subscriptions')
    .select('id,status,plan_code,price_cents,letters_included_remaining')
    .eq('user_id', userId);
  if (!subs?.length) fail('autopilot_subscriptions: no row');
  else {
    const sub = subs[0] as any;
    pass(`autopilot_subscriptions: ${sub.plan_code} status=${sub.status} price_cents=${sub.price_cents}`);
    if (sub.status !== 'active') fail(`subscription status not active: ${sub.status}`);
    if (sub.plan_code !== 'COMP_PARTNER') fail(`expected plan_code=COMP_PARTNER, got ${sub.plan_code}`);
    if (sub.price_cents !== 0) fail(`expected price_cents=0, got ${sub.price_cents}`);
  }

  // 4) monitored_plates
  const { data: plates } = await supabase
    .from('monitored_plates')
    .select('plate,state,status')
    .eq('user_id', userId);
  if (!plates?.length) fail('monitored_plates: no row');
  else {
    const p = plates[0] as any;
    pass(`monitored_plates: ${p.plate}/${p.state} status=${p.status}`);
    if (p.status !== 'active') fail(`monitored_plate not active: ${p.status}`);
  }

  // 5) audit log
  const { data: audit } = await supabase
    .from('audit_logs')
    .select('action_type,action_details,created_at')
    .eq('user_id', userId)
    .eq('action_type', 'comp_access_granted')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!audit?.length) fail('audit_logs: no comp_access_granted entry');
  else {
    const a = audit[0] as any;
    pass(`audit_logs: comp_access_granted at ${a.created_at} (source=${a.action_details?.source})`);
  }

  console.log('');
  if (ok) {
    console.log('All checks passed.');
    process.exit(0);
  } else {
    console.log('FAIL — see ❌ above.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
