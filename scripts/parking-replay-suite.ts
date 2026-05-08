#!/usr/bin/env npx tsx
/**
 * Parking Regression Replay Suite
 *
 * Pulls every parking_diagnostics row that has user-confirmed ground truth
 * and replays its raw inputs through the live check-parking algorithm.
 * Reports street-correct / address-changed counts and exits non-zero on
 * any regression vs. the most recent prior pass.
 *
 * Each labeled event = one permanent test case. As the labeled corpus grows
 * (via scripts/record-parking-truth.js or in-app feedback), this suite gets
 * more useful — every change to check-parking can be evaluated against the
 * full set of known good/bad answers before deploy.
 *
 * Requires: native_meta.replay_inputs persisted on every diag row (added
 * 2026-05-08). Older rows missing replay_inputs are skipped with a warning.
 *
 * Usage:
 *   npx tsx scripts/parking-replay-suite.ts                       # default: prod
 *   npx tsx scripts/parking-replay-suite.ts --url https://...     # alt target
 *   npx tsx scripts/parking-replay-suite.ts --json out.json       # write report
 *   npx tsx scripts/parking-replay-suite.ts --user <email>        # one user only
 *
 * The script writes a fresh diag row for each replay (live endpoint always
 * inserts). Replay rows are tagged with native_meta.is_replay=true so they
 * don't pollute the labeled corpus on a re-run.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true } as any);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i < process.argv.length - 1 ? process.argv[i + 1] : def;
}

const baseUrl = arg('url', 'https://www.autopilotamerica.com')!;
const jsonOut = arg('json');
const userFilter = arg('user');

interface LabeledEvent {
  id: number;
  user_id: string | null;
  user_email?: string;
  raw_lat: number;
  raw_lng: number;
  resolved_address: string | null;
  resolved_street_name: string | null;
  resolved_house_number: number | null;
  resolved_side: string | null;
  user_confirmed_block: boolean | null;
  user_reported_side: string | null;
  street_correct: boolean | null;
  side_correct: boolean | null;
  native_meta: Record<string, any> | null;
}

const TOKEN_CACHE = new Map<string, string>();

async function tokenFor(userId: string, email: string): Promise<string | null> {
  if (TOKEN_CACHE.has(userId)) return TOKEN_CACHE.get(userId)!;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !(link as any)?.properties?.email_otp) {
    console.warn(`  [skip ${email}] could not mint OTP: ${linkErr?.message ?? 'no otp'}`);
    return null;
  }
  const otp = (link as any).properties.email_otp;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: ses, error: sesErr } = await anon.auth.verifyOtp({ email, token: otp, type: 'magiclink' });
  if (sesErr || !ses?.session?.access_token) {
    console.warn(`  [skip ${email}] could not exchange OTP: ${sesErr?.message ?? 'no session'}`);
    return null;
  }
  TOKEN_CACHE.set(userId, ses.session.access_token);
  return ses.session.access_token;
}

async function loadLabeledEvents(): Promise<LabeledEvent[]> {
  let q = admin
    .from('parking_diagnostics')
    .select(
      'id, user_id, raw_lat, raw_lng, resolved_address, resolved_street_name, resolved_house_number, resolved_side, user_confirmed_block, user_reported_side, street_correct, side_correct, native_meta',
    )
    .not('user_feedback_at', 'is', null)
    .order('id', { ascending: true });
  // Only events the user actually labeled (has ground truth note OR explicit confirmation)
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any as LabeledEvent[];
  // Filter to events with usable ground truth + replay inputs
  const usable: LabeledEvent[] = [];
  for (const r of rows) {
    const meta = (r.native_meta && typeof r.native_meta === 'object') ? r.native_meta : {};
    if (meta.is_replay === true) continue; // skip prior replay rows
    const hasGroundTruth =
      r.user_confirmed_block != null ||
      meta.ground_truth != null ||
      meta.corrected_address != null;
    if (!hasGroundTruth) continue;
    usable.push({ ...r, native_meta: meta });
  }
  // Look up user emails so we can mint impersonation tokens
  const userIds = Array.from(new Set(usable.map((r) => r.user_id).filter(Boolean))) as string[];
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('user_id, email')
      .in('user_id', userIds);
    const emailByUser = new Map<string, string>();
    (profiles ?? []).forEach((p: any) => emailByUser.set(p.user_id, p.email));
    for (const r of usable) {
      if (r.user_id) r.user_email = emailByUser.get(r.user_id);
    }
  }
  return userFilter ? usable.filter((r) => r.user_email === userFilter) : usable;
}

function buildBody(replayInputs: Record<string, any>) {
  const body: Record<string, any> = {
    latitude: replayInputs.latitude,
    longitude: replayInputs.longitude,
    is_replay: true,
  };
  if (replayInputs.accuracy_meters != null) body.accuracy_meters = replayInputs.accuracy_meters;
  if (replayInputs.heading != null) body.heading = replayInputs.heading;
  if (replayInputs.compass_heading != null) body.compass_heading = replayInputs.compass_heading;
  if (replayInputs.compass_confidence != null) body.compass_confidence = replayInputs.compass_confidence;
  if (replayInputs.driving_duration_sec != null) body.driving_duration_sec = replayInputs.driving_duration_sec;
  if (replayInputs.drift_from_parking_distance != null) body.drift_from_parking_distance = replayInputs.drift_from_parking_distance;
  if (replayInputs.location_source) body.location_source = replayInputs.location_source;
  if (replayInputs.detection_source) body.detection_source = replayInputs.detection_source;
  if (replayInputs.drive_trajectory) body.drive_trajectory = JSON.stringify(replayInputs.drive_trajectory);
  if (replayInputs.apple_geocode) body.apple_geocode = JSON.stringify(replayInputs.apple_geocode);
  if (replayInputs.vehicle_id) body.vehicle_id = replayInputs.vehicle_id;
  if (replayInputs.vehicle_id_source) body.vehicle_id_source = replayInputs.vehicle_id_source;
  if (replayInputs.vehicle_name) body.vehicle_name = replayInputs.vehicle_name;
  if (replayInputs.cp_disconnect_at != null) body.cp_disconnect_at = replayInputs.cp_disconnect_at;
  if (replayInputs.cp_disconnect_lat != null) body.cp_disconnect_lat = replayInputs.cp_disconnect_lat;
  if (replayInputs.cp_disconnect_lng != null) body.cp_disconnect_lng = replayInputs.cp_disconnect_lng;
  if (replayInputs.cp_connected_at != null) body.cp_connected_at = replayInputs.cp_connected_at;
  if (replayInputs.cp_active_during_drive != null) body.cp_active_during_drive = replayInputs.cp_active_during_drive ? '1' : '0';
  if (replayInputs.confidence) body.confidence = replayInputs.confidence;
  return body;
}

function normStreet(s: string | null | undefined) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/\b(north|south|east|west|n|s|e|w|ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane)\b/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

interface ReplayResult {
  diagId: number;
  userEmail?: string;
  expectedNote: string;
  expectedStreet: string | null;
  originalStreet: string | null;
  originalAddress: string | null;
  replayedStreet: string | null;
  replayedAddress: string | null;
  changed: boolean;
  hasReplayInputs: boolean;
  replayDiagId?: number;
  expectedConfirmedBlock: boolean | null;
  // After replay, did the new street match the user's reported correct street?
  replayMatchesGroundTruth: boolean | null;
}

async function replayOne(ev: LabeledEvent): Promise<ReplayResult> {
  const meta = ev.native_meta || {};
  const groundTruth = meta.ground_truth || {};
  const expectedStreet = groundTruth.street ?? null;
  const expectedNote = groundTruth.raw ?? meta.feedback_note ?? meta.corrected_address ?? '(no note)';
  const replayInputs = meta.replay_inputs;
  const result: ReplayResult = {
    diagId: ev.id,
    userEmail: ev.user_email,
    expectedNote,
    expectedStreet,
    originalStreet: ev.resolved_street_name,
    originalAddress: ev.resolved_address,
    replayedStreet: null,
    replayedAddress: null,
    changed: false,
    hasReplayInputs: !!replayInputs,
    expectedConfirmedBlock: ev.user_confirmed_block,
    replayMatchesGroundTruth: null,
  };
  if (!replayInputs) {
    return result;
  }
  if (!ev.user_id || !ev.user_email) {
    console.warn(`  [skip diag ${ev.id}] no user_id/email available for token`);
    return result;
  }
  const token = await tokenFor(ev.user_id, ev.user_email);
  if (!token) return result;
  try {
    const beforeIds = await admin
      .from('parking_diagnostics')
      .select('id')
      .eq('user_id', ev.user_id)
      .order('id', { ascending: false })
      .limit(1);
    const lastIdBefore = beforeIds.data?.[0]?.id ?? 0;
    const resp = await fetch(`${baseUrl}/api/mobile/check-parking`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildBody(replayInputs)),
    });
    if (!resp.ok) {
      console.warn(`  [skip diag ${ev.id}] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return result;
    }
    const data = await resp.json();
    const pa = data.parsedAddress || {};
    result.replayedStreet = pa.name ?? null;
    result.replayedAddress = data.address ?? null;
    result.changed = normStreet(result.originalStreet) !== normStreet(result.replayedStreet);
    if (expectedStreet) {
      result.replayMatchesGroundTruth =
        normStreet(result.replayedStreet) === normStreet(expectedStreet);
    }
    // Find the new diag row this replay created and mark it
    const afterIds = await admin
      .from('parking_diagnostics')
      .select('id, native_meta')
      .eq('user_id', ev.user_id)
      .gt('id', lastIdBefore)
      .order('id', { ascending: false })
      .limit(1);
    const newRow = afterIds.data?.[0];
    if (newRow) {
      result.replayDiagId = newRow.id;
      const newMeta = (newRow.native_meta && typeof newRow.native_meta === 'object') ? newRow.native_meta : {};
      await admin
        .from('parking_diagnostics')
        .update({ native_meta: { ...newMeta, is_replay: true, replayed_from_diag_id: ev.id } })
        .eq('id', newRow.id);
    }
  } catch (e: any) {
    console.warn(`  [skip diag ${ev.id}] replay failed: ${e?.message ?? e}`);
  }
  return result;
}

(async () => {
  console.log(`=== Parking Regression Replay Suite ===`);
  console.log(`Target: ${baseUrl}`);
  const events = await loadLabeledEvents();
  console.log(`Labeled events with ground truth: ${events.length}`);
  if (userFilter) console.log(`Filtered to user: ${userFilter}`);
  if (events.length === 0) {
    console.log('No labeled events yet. Use scripts/record-parking-truth.js to label one.');
    process.exit(0);
  }

  const results: ReplayResult[] = [];
  for (const ev of events) {
    process.stdout.write(`  Replaying #${ev.id} (${ev.user_email ?? 'unknown'})... `);
    const r = await replayOne(ev);
    results.push(r);
    if (!r.hasReplayInputs) {
      console.log('SKIP (no replay_inputs in native_meta — pre-2026-05-08 row)');
    } else if (!r.replayedStreet) {
      console.log('FAIL (no response)');
    } else if (r.expectedStreet && r.replayMatchesGroundTruth) {
      console.log(`PASS  (got ${r.replayedStreet}, ground truth = ${r.expectedStreet})`);
    } else if (r.expectedStreet && r.replayMatchesGroundTruth === false) {
      console.log(`FAIL  (got ${r.replayedStreet}, ground truth = ${r.expectedStreet})`);
    } else {
      console.log(`(no structured truth)  got ${r.replayedStreet}; original was ${r.originalStreet}`);
    }
  }

  const total = results.length;
  const usable = results.filter((r) => r.hasReplayInputs && !!r.replayedStreet).length;
  const matched = results.filter((r) => r.replayMatchesGroundTruth === true).length;
  const failed = results.filter((r) => r.replayMatchesGroundTruth === false).length;
  const noTruth = results.filter((r) => r.expectedStreet === null && r.hasReplayInputs && !!r.replayedStreet).length;

  console.log('');
  console.log('=== RESULTS ===');
  console.log(`Total labeled events:      ${total}`);
  console.log(`Replayed successfully:     ${usable}`);
  console.log(`Match ground truth:        ${matched}`);
  console.log(`Fail vs ground truth:      ${failed}`);
  console.log(`No structured truth:       ${noTruth}`);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ baseUrl, when: new Date().toISOString(), results }, null, 2));
    console.log(`Wrote ${jsonOut}`);
  }
  if (failed > 0) {
    console.log('');
    console.log('FAILED CASES:');
    for (const r of results.filter((x) => x.replayMatchesGroundTruth === false)) {
      console.log(`  diag #${r.diagId}: expected ${r.expectedStreet}, got ${r.replayedStreet}`);
      console.log(`    "${r.expectedNote.slice(0, 100)}"`);
      console.log(`    original answer was: ${r.originalAddress}`);
      console.log(`    replayed answer is:  ${r.replayedAddress}`);
    }
    process.exit(1);
  }
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
