#!/usr/bin/env node
/**
 * Grant comp (free) paid access to a user.
 *
 * Usage:
 *   node scripts/grant-comp-access.js <email> [--reason "..."] [--create]
 *                                              [--plate ABC123 --state IL]
 *                                              [--no-email] [--dry-run]
 *
 * Default behavior:
 *   - If the user already exists in auth.users, flips user_profiles flags to paid
 *     and ensures they have an active subscription + monitored_plates row.
 *   - If the user does NOT exist, errors out unless --create is passed.
 *
 * With --create:
 *   - Creates auth user, seeds user_profiles, flips paid flags.
 *   - Looks up the most recent funnel_leads row matching the email or plate
 *     and copies address/vehicle/name fields onto user_profiles.
 *   - Inserts an active autopilot_subscriptions row (plan_code=COMP_MANUAL,
 *     no Stripe IDs) so the portal scraper picks the user up.
 *   - Inserts an active monitored_plates row if a plate is known (from CLI
 *     flag or funnel_leads).
 *   - Marks the funnel_leads row as converted (links converted_user_id).
 *   - Sends invite email by default; --no-email prints a magic-link URL instead.
 *
 * Flags flipped on user_profiles:
 *   is_paid = true
 *   has_contesting = true   (mobile App.tsx:125 gates on EITHER flag)
 *
 * Why is the subscription/plate insert here?
 *   The portal scraper queries autopilot_subscriptions (status=active) and
 *   monitored_plates (status=active) — NOT user_profiles.is_paid. Without
 *   these inserts, comp users are silently excluded from auto-contest.
 *
 * Idempotent: safe to re-run on the same email.
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// Fields that we copy from funnel_leads to user_profiles when present.
// Mirrors the mapping in pages/api/funnel/apply-to-user.ts.
const FUNNEL_TO_PROFILE = {
  first_name: 'first_name',
  last_name: 'last_name',
  phone_number: 'phone_number',
  license_plate: 'license_plate',
  license_state: 'license_state',
  vehicle_make: 'vehicle_make',
  vehicle_model: 'vehicle_model',
  vehicle_color: 'vehicle_color',
  vehicle_year: 'vehicle_year',
  home_address_full: 'home_address_full',
  mailing_address: 'mailing_address',
  mailing_city: 'mailing_city',
  mailing_state: 'mailing_state',
  mailing_zip: 'mailing_zip',
  city_sticker_expiry: 'city_sticker_expiry',
  plate_expiry: 'license_plate_expiry',
};

function parseArgs(argv) {
  const out = { create: false, dryRun: false, sendEmail: null, plate: null, state: null };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reason') out.reason = argv[++i];
    else if (a === '--create') out.create = true;
    else if (a === '--no-email') out.sendEmail = false;
    else if (a === '--send-email') out.sendEmail = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--plate') out.plate = argv[++i];
    else if (a === '--state') out.state = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  if (out.sendEmail === null) out.sendEmail = out.create;
  out.email = positional[0];
  return out;
}

function printHelp() {
  const help = [
    'Usage: node scripts/grant-comp-access.js <email> [options]',
    '',
    '  --create               Create the auth user if missing',
    '  --plate ABC123         Plate to monitor (overrides funnel_leads)',
    '  --state IL             State for the plate (default IL)',
    '  --reason "..."         Note saved to audit_logs',
    '  --no-email             Skip Supabase invite email; print magic link to stdout',
    '  --dry-run              Print what would happen without writing',
  ].join('\n');
  console.log(help);
}

async function findAuthUser(email) {
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function createAuthUser(email, { sendInvite }) {
  if (sendInvite) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://autopilotamerica.com',
    });
    if (error) throw new Error(`inviteUserByEmail failed: ${error.message}`);
    return data.user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return data.user;
}

async function findFunnelLead({ email, plate }) {
  // Try email match first (case-insensitive). Then plate. Most recent wins.
  let row = null;
  if (email) {
    const { data } = await supabase
      .from('funnel_leads')
      .select('*')
      .ilike('email', email)
      .is('converted_user_id', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (data?.length) row = data[0];
  }
  if (!row && plate) {
    const { data } = await supabase
      .from('funnel_leads')
      .select('*')
      .ilike('license_plate', plate)
      .is('converted_user_id', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (data?.length) row = data[0];
  }
  return row;
}

async function upsertProfile(user, email, leadRow) {
  // Build patch from funnel_leads (only non-null fields). Always set the paid flags.
  const patch = { is_paid: true, has_contesting: true, email };
  if (leadRow) {
    for (const [src, dst] of Object.entries(FUNNEL_TO_PROFILE)) {
      if (leadRow[src] != null && leadRow[src] !== '') patch[dst] = leadRow[src];
    }
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('user_profiles')
    .select('user_id,email,is_paid,has_contesting,license_plate')
    .eq('user_id', user.id)
    .maybeSingle();
  if (fetchErr) throw new Error(`profile lookup failed: ${fetchErr.message}`);

  if (existing) {
    // Don't overwrite an already-set email with a different one.
    patch.email = existing.email || email;
    const { error } = await supabase.from('user_profiles').update(patch).eq('user_id', user.id);
    if (error) throw new Error(`profile update failed: ${error.message}`);
    return { action: 'updated', before: existing, patch };
  }

  const { error } = await supabase.from('user_profiles').insert({ user_id: user.id, ...patch });
  if (error) throw new Error(`profile insert failed: ${error.message}`);
  return { action: 'inserted', before: null, patch };
}

async function ensureSubscription(userId) {
  const { data: existing } = await supabase
    .from('autopilot_subscriptions')
    .select('id, status, plan_code')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('authorization_revoked_at', null)
    .limit(1);
  if (existing?.length) return { action: 'kept', row: existing[0] };

  const { data, error } = await supabase
    .from('autopilot_subscriptions')
    .insert({
      user_id: userId,
      plan: 'autopilot',
      status: 'active',
      letters_included_remaining: 999,
      authorized_at: new Date().toISOString(),
      plan_code: 'COMP_MANUAL',
      price_cents: 0,
      grace_period_days: 7,
    })
    .select()
    .single();
  if (error) throw new Error(`subscription insert failed: ${error.message}`);
  return { action: 'inserted', row: data };
}

async function ensureMonitoredPlate(userId, plate, state) {
  if (!plate) return { action: 'skipped', reason: 'no plate provided or in funnel' };
  const cleanPlate = plate.toUpperCase().trim();
  const cleanState = (state || 'IL').toUpperCase().trim();

  const { data: existing } = await supabase
    .from('monitored_plates')
    .select('id, plate, state, status')
    .eq('user_id', userId)
    .eq('plate', cleanPlate)
    .limit(1);
  if (existing?.length) {
    if (existing[0].status === 'active') return { action: 'kept', row: existing[0] };
    // Re-activate
    const { data, error } = await supabase
      .from('monitored_plates')
      .update({ status: 'active' })
      .eq('id', existing[0].id)
      .select()
      .single();
    if (error) throw new Error(`monitored_plate reactivate failed: ${error.message}`);
    return { action: 'reactivated', row: data };
  }

  const { data, error } = await supabase
    .from('monitored_plates')
    .insert({
      user_id: userId,
      plate: cleanPlate,
      state: cleanState,
      status: 'active',
      is_leased_or_company: false,
    })
    .select()
    .single();
  if (error) throw new Error(`monitored_plate insert failed: ${error.message}`);
  return { action: 'inserted', row: data };
}

async function markLeadConverted(leadId, userId, email) {
  const { error } = await supabase
    .from('funnel_leads')
    .update({
      converted_user_id: userId,
      converted_at: new Date().toISOString(),
      email,
    })
    .eq('id', leadId);
  if (error) console.warn(`funnel_leads convert failed (non-fatal): ${error.message}`);
}

async function generateMagicLink(email) {
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`magic link failed: ${error.message}`);
  return data.properties?.action_link || null;
}

async function writeAuditLog({ userId, email, reason, action, createdAccount, leadFound, plate }) {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: userId,
    action_type: 'comp_access_granted',
    entity_type: 'user_profile',
    entity_id: userId,
    action_details: {
      email,
      reason: reason || null,
      profile_action: action,
      created_account: createdAccount,
      funnel_lead_applied: leadFound,
      plate_monitored: plate || null,
      granted_by: 'grant-comp-access.js',
      granted_at: new Date().toISOString(),
    },
    status: 'success',
  });
  if (error) console.warn(`audit_logs insert failed (non-fatal): ${error.message}`);
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help || !args.email) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const email = args.email.trim().toLowerCase();
  console.log(`-> target: ${email}${args.dryRun ? '  (DRY RUN)' : ''}`);

  let user = await findAuthUser(email);
  let createdAccount = false;

  if (!user) {
    if (!args.create) {
      console.error(`no auth user for ${email} — re-run with --create to pre-provision them`);
      process.exit(2);
    }
    if (args.dryRun) {
      console.log(`would: ${args.sendEmail ? 'invite (create + email)' : 'create'} auth user, upsert user_profiles row, insert subscription + monitored_plate`);
      process.exit(0);
    }
    console.log(`-> ${args.sendEmail ? 'inviting' : 'creating'} auth user...`);
    user = await createAuthUser(email, { sendInvite: args.sendEmail });
    createdAccount = true;
    console.log(`   created user_id=${user.id}${args.sendEmail ? ' (invite email sent)' : ''}`);
  } else {
    console.log(`-> found auth user: ${user.id} (created ${user.created_at})`);
  }

  if (args.dryRun) {
    console.log(`would: flip is_paid+has_contesting, copy funnel_leads, insert subscription + monitored_plate (user_id=${user.id})`);
    process.exit(0);
  }

  // Pull from funnel_leads to enrich the profile.
  const lead = await findFunnelLead({ email, plate: args.plate });
  if (lead) {
    console.log(`-> funnel_leads match: id=${lead.id} (last step: ${lead.last_step_reached})`);
  } else {
    console.log(`-> no funnel_leads row found for email or plate`);
  }

  const { action, before, patch } = await upsertProfile(user, email, lead);
  console.log(`-> profile ${action}: ${Object.keys(patch).length} field(s) set`);
  if (patch.license_plate) console.log(`   plate=${patch.license_plate} (${patch.license_state || 'IL'})`);
  if (patch.mailing_address) console.log(`   mailing=${patch.mailing_address}, ${patch.mailing_city}, ${patch.mailing_state} ${patch.mailing_zip}`);

  // Insert subscription so the portal scraper picks them up.
  const sub = await ensureSubscription(user.id);
  console.log(`-> autopilot_subscription ${sub.action}${sub.row ? ` (id=${sub.row.id})` : ''}`);

  // Insert monitored_plate. Prefer CLI flag, then funnel_leads.
  const plateForMonitor = args.plate || lead?.license_plate || patch.license_plate;
  const stateForMonitor = args.state || lead?.license_state || patch.license_state || 'IL';
  const mp = await ensureMonitoredPlate(user.id, plateForMonitor, stateForMonitor);
  console.log(`-> monitored_plate ${mp.action}${mp.row ? ` (${mp.row.plate}/${mp.row.state})` : ''}${mp.reason ? ` — ${mp.reason}` : ''}`);

  // Mark the funnel lead as converted so future runs don't double-apply it.
  if (lead && !lead.converted_user_id) {
    await markLeadConverted(lead.id, user.id, email);
    console.log(`-> funnel_leads ${lead.id} marked converted`);
  }

  await writeAuditLog({
    userId: user.id,
    email,
    reason: args.reason,
    action,
    createdAccount,
    leadFound: !!lead,
    plate: plateForMonitor,
  });
  console.log(`-> audit log written`);

  if (createdAccount && !args.sendEmail) {
    const link = await generateMagicLink(email);
    if (link) {
      console.log('');
      console.log(`Magic link for ${email} (expires per Supabase config):`);
      console.log(link);
      console.log('');
      console.log(`Send this link to the user — clicking it signs them in on the web app.`);
    }
  } else if (createdAccount && args.sendEmail) {
    console.log(`-> invite email delivered via Supabase to ${email}`);
  }

  console.log(`\nDone. ${email} now has paid access${plateForMonitor ? ` and ${plateForMonitor} is being monitored` : ''}.`);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
