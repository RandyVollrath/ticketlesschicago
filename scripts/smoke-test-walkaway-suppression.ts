#!/usr/bin/env tsx
/**
 * Smoke test for the walk-away + low-confidence parking suppression
 * shipped May 2026 in pages/api/mobile/check-parking.ts.
 *
 * Hits the LIVE deployed API with two payloads that mimic the real
 * false-positive events from Randy's debug report 507dab9f:
 *
 *  1. Wolcott→Lawrence walk-away (id=148, May 5 2026, hd=158).
 *     Body sets compass+gps headings ~158° apart. Server should set
 *     `suppressNotifications: true` with reason walkaway_suspected.
 *
 *  2. 2474 N Southport red-light no-snap (id=134, May 4 2026,
 *     coords mid-intersection, no snap centerline). Server should
 *     set `suppressNotifications: true` with reason no_snap_no_confidence.
 *
 * Both events should return a 200 response with the suppression flag set.
 * If either does not, the guard isn't firing.
 *
 * Run after deploy: npx tsx scripts/smoke-test-walkaway-suppression.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const HOST = process.env.SMOKE_HOST || 'https://www.autopilotamerica.com';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let cachedToken: string | null = null;
async function getRandyAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const randy = users?.users.find(u => u.email === 'randyvollrath@gmail.com');
  if (!randy) throw new Error('randyvollrath@gmail.com not found');
  // generateLink → magiclink contains a URL whose access_token we can grab.
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: randy.email! });
  if (error) throw error;
  // The action_link has #access_token=…&refresh_token=… — but generateLink in
  // newer supabase-js returns properties directly via verifyOtp on token_hash.
  const tokenHash = (data as any).properties?.hashed_token;
  if (!tokenHash) throw new Error('no hashed_token returned by generateLink');
  const { data: verified, error: verErr } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (verErr || !verified.session) throw verErr || new Error('verifyOtp returned no session');
  cachedToken = verified.session.access_token;
  return cachedToken;
}

async function call(label: string, body: Record<string, any>) {
  console.log(`\n=== ${label} ===`);
  console.log(`  POST ${HOST}/api/mobile/check-parking`);
  const token = await getRandyAccessToken();
  const res = await fetch(`${HOST}/api/mobile/check-parking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  console.log(`  status: ${res.status}`);
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    console.log(`  body:`, json);
    return null;
  }
  console.log(`  address: ${json.address}`);
  console.log(`  addressConfidence: ${json.addressConfidence}`);
  console.log(`  needsVerification: ${json.needsVerification}`);
  console.log(`  suppressNotifications: ${json.suppressNotifications}`);
  console.log(`  suppressionReason: ${json.suppressionReason}`);
  return json;
}

(async () => {
  // 1. Walk-away case: lat/lng on Lawrence with GPS heading=87.9° (E-W),
  //    compassHeading=246° (N-S, ~158° off). Both real values from id=148.
  const wolcott = await call('Wolcott→Lawrence walk-away', {
    latitude: 41.9689158515957,
    longitude: -87.6756653114322,
    accuracy: 4.5,
    heading: 87.9,
    compass_heading: 246,
    compass_confidence: 6.1,
    location_source: 'stop_start',
    detection_source: 'gps_coremotion_agree',
    driving_duration_sec: 963,
  });

  // 2. Low-confidence no-snap: lat/lng mid-intersection at 2474 N Southport.
  //    Real coords from id=134. Snap returns null at this point because the
  //    GPS lands between centerlines.
  const southport = await call('2474 N Southport red-light no-snap', {
    latitude: 41.9262605387079,
    longitude: -87.663888162153,
    accuracy: 4.1,
    heading: 358.4,
    compass_heading: 99.8,
    compass_confidence: 3.8,
    location_source: 'stop_start',
    detection_source: 'coremotion_walking',
    driving_duration_sec: 570,
  });

  console.log('\n=== RESULT ===');
  let pass = true;
  if (!wolcott?.suppressNotifications) {
    console.log('❌ Wolcott→Lawrence: walkaway suppression did NOT fire');
    pass = false;
  } else {
    console.log(`✅ Wolcott→Lawrence: suppressed (${wolcott.suppressionReason})`);
  }
  if (!southport?.suppressNotifications) {
    console.log('❌ Southport: low-confidence suppression did NOT fire');
    pass = false;
  } else {
    console.log(`✅ Southport: suppressed (${southport.suppressionReason})`);
  }
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
