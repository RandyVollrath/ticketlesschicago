#!/usr/bin/env npx tsx
/**
 * Analyze CarPlay port_uid coverage and revisit patterns to inform the
 * "carplay-known-spot" confidence bump in pages/api/mobile/check-parking.ts.
 *
 * Background: starting 2026-04-27 (commit d998ba86) we capture
 * AVAudioSessionPortDescription.uid + portName from CarPlay-paired drives
 * and persist them in parking_diagnostics.native_meta as carPlayPortUid +
 * carPlayPortName. Apple does NOT expose VIN/speed/fuel — portUid is what's
 * available without an entitlement, and is stable per CarPlay pairing.
 *
 * This script answers: how often is CarPlay actually used, how many
 * (user, port_uid, spot) triples have enough revisits to be diagnostic,
 * and what threshold + confidence delta should the live lookup use.
 *
 * Output is human-readable plain text. Re-run any time after data
 * accumulates: `npx tsx scripts/analyze-carplay-port-uid.ts`
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const SINCE = '2026-04-27T00:00:00Z'; // first day of capture
const SPOT_BUCKET_M = 30; // spots within this distance count as the same spot

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

(async () => {
  console.log('=== CarPlay port_uid analytics ===');
  console.log(`Window: ${SINCE} → now`);
  console.log(`Spot bucket: ${SPOT_BUCKET_M}m\n`);

  // Step 1: Coverage. How many parking_diagnostics rows have carPlayPortUid?
  const { count: totalCount, error: tErr } = await s
    .from('parking_diagnostics')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', SINCE);
  if (tErr) { console.error('Total count failed:', tErr.message); process.exit(1); }

  const { count: cpCount, error: cErr } = await (s as any)
    .from('parking_diagnostics')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', SINCE)
    .not('native_meta->>carPlayPortUid', 'is', null);
  if (cErr) { console.error('CarPlay count failed:', cErr.message); process.exit(1); }

  const coverage = totalCount ? ((cpCount! / totalCount) * 100).toFixed(1) : '0';
  console.log(`Coverage: ${cpCount}/${totalCount} parking diagnostics carry a CarPlay port_uid (${coverage}%)\n`);

  if (!cpCount || cpCount === 0) {
    console.log('NO CARPLAY DATA YET — feature may not have rolled out, or no users on CarPlay drives.');
    console.log('Re-run this script once parking_diagnostics has CarPlay rows.');
    process.exit(0);
  }

  // Step 2: Pull all CarPlay rows for in-memory analysis. ~weeks of data
  // should be small enough to fit in memory. If this grows, paginate.
  const { data: rows, error: rErr } = await (s as any)
    .from('parking_diagnostics')
    .select('user_id, raw_lat, raw_lng, snapped_lat, snapped_lng, native_meta, created_at')
    .gte('created_at', SINCE)
    .not('native_meta->>carPlayPortUid', 'is', null)
    .order('created_at', { ascending: true })
    .limit(20000);
  if (rErr) { console.error('Pull failed:', rErr.message); process.exit(1); }

  console.log(`Pulled ${rows!.length} CarPlay rows for in-memory analysis.\n`);

  // Step 3: Group by (user_id, port_uid). For each group, collapse parks
  // into ~30m spots greedily.
  type Row = {
    user_id: string | null;
    lat: number;
    lng: number;
    portUid: string;
    portName: string | null;
    createdAt: string;
  };
  const byPair: Map<string, Row[]> = new Map();
  for (const r of rows as any[]) {
    if (!r.user_id) continue;
    const lat = r.snapped_lat ?? r.raw_lat;
    const lng = r.snapped_lng ?? r.raw_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const portUid = r.native_meta?.carPlayPortUid;
    const portName = r.native_meta?.carPlayPortName ?? null;
    if (typeof portUid !== 'string' || portUid.length === 0) continue;
    const key = `${r.user_id}|${portUid}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push({ user_id: r.user_id, lat, lng, portUid, portName, createdAt: r.created_at });
  }

  // Step 4: For each pair, greedy spot clustering.
  type Spot = { lat: number; lng: number; visits: number };
  const spotsPerPair: Map<string, Spot[]> = new Map();
  for (const [key, parks] of byPair) {
    const spots: Spot[] = [];
    for (const p of parks) {
      let matched = false;
      for (const sp of spots) {
        if (haversineMeters(p.lat, p.lng, sp.lat, sp.lng) <= SPOT_BUCKET_M) {
          // Update centroid via running mean
          sp.lat = (sp.lat * sp.visits + p.lat) / (sp.visits + 1);
          sp.lng = (sp.lng * sp.visits + p.lng) / (sp.visits + 1);
          sp.visits++;
          matched = true;
          break;
        }
      }
      if (!matched) spots.push({ lat: p.lat, lng: p.lng, visits: 1 });
    }
    spotsPerPair.set(key, spots);
  }

  // Step 5: Distributions.
  const distinctSpotsPerPair: number[] = [];
  const visitsPerSpot: number[] = [];
  let totalSpots = 0;
  let spotsWith3PlusVisits = 0;
  let spotsWith5PlusVisits = 0;
  for (const spots of spotsPerPair.values()) {
    distinctSpotsPerPair.push(spots.length);
    for (const sp of spots) {
      visitsPerSpot.push(sp.visits);
      totalSpots++;
      if (sp.visits >= 3) spotsWith3PlusVisits++;
      if (sp.visits >= 5) spotsWith5PlusVisits++;
    }
  }

  console.log(`Unique (user, port_uid) pairs: ${byPair.size}`);
  console.log(`Total distinct spots across all pairs: ${totalSpots}`);
  console.log(`Spots with ≥3 visits: ${spotsWith3PlusVisits} (${((spotsWith3PlusVisits / totalSpots) * 100).toFixed(1)}%)`);
  console.log(`Spots with ≥5 visits: ${spotsWith5PlusVisits} (${((spotsWith5PlusVisits / totalSpots) * 100).toFixed(1)}%)\n`);

  console.log('Distinct spots per (user, port_uid):');
  console.log(`  median=${pct(distinctSpotsPerPair, 50)}  p90=${pct(distinctSpotsPerPair, 90)}  max=${Math.max(...distinctSpotsPerPair, 0)}\n`);

  console.log('Visits per spot (all pairs pooled):');
  console.log(`  median=${pct(visitsPerSpot, 50)}  p90=${pct(visitsPerSpot, 90)}  max=${Math.max(...visitsPerSpot, 0)}\n`);

  // Step 6: Anomalies.
  const portUidToUsers: Map<string, Set<string>> = new Map();
  const userToPortUids: Map<string, Set<string>> = new Map();
  for (const key of byPair.keys()) {
    const [userId, portUid] = key.split('|');
    if (!portUidToUsers.has(portUid)) portUidToUsers.set(portUid, new Set());
    portUidToUsers.get(portUid)!.add(userId);
    if (!userToPortUids.has(userId)) userToPortUids.set(userId, new Set());
    userToPortUids.get(userId)!.add(portUid);
  }

  const sharedPortUids = Array.from(portUidToUsers.entries()).filter(([_, users]) => users.size > 1);
  const usersWithManyPortUids = Array.from(userToPortUids.entries()).filter(([_, uids]) => uids.size > 5);

  console.log('=== Anomalies ===');
  if (sharedPortUids.length > 0) {
    console.log(`⚠️  ${sharedPortUids.length} port_uids appear across MULTIPLE users (uid may not be stable per pairing as expected):`);
    for (const [uid, users] of sharedPortUids.slice(0, 5)) {
      console.log(`    ${uid.slice(0, 32)}... → ${users.size} users`);
    }
  } else {
    console.log('✅ No port_uid is shared across users — uid appears stable per pairing.');
  }
  if (usersWithManyPortUids.length > 0) {
    console.log(`⚠️  ${usersWithManyPortUids.length} users have >5 distinct port_uids (multi-vehicle households, or uid churn?):`);
    for (const [u, uids] of usersWithManyPortUids.slice(0, 5)) {
      console.log(`    user=${u.slice(0, 8)}... → ${uids.size} distinct port_uids`);
    }
  } else {
    console.log('✅ No user with >5 distinct port_uids — single-vehicle pattern dominates.');
  }
  console.log();

  // Step 7: Recommendation. Pick threshold so that "known spot" is rare
  // enough not to false-positive on coincidental visits, common enough to
  // matter. p50 visits-per-spot tells us where the bulk lives.
  const medianVisits = pct(visitsPerSpot, 50);
  const recommendedThreshold = medianVisits >= 3 ? 5 : Math.max(3, medianVisits + 1);
  // Confidence delta: small when threshold is loose, larger when tight.
  // Existing carplay-anchored = +12, carplay-active-drive = +4.
  const recommendedDelta = recommendedThreshold >= 5 ? 12 : recommendedThreshold === 4 ? 9 : 6;

  console.log('=== Recommendation ===');
  console.log(`Threshold: ≥${recommendedThreshold} prior visits at the same spot in the same car.`);
  console.log(`Confidence delta: +${recommendedDelta}  (reason: "carplay-known-spot")`);
  console.log();

  console.log('Lookup query for check-parking.ts:');
  console.log(`  SELECT count(*) FROM parking_diagnostics`);
  console.log(`  WHERE user_id = $1`);
  console.log(`    AND native_meta->>'carPlayPortUid' = $2`);
  console.log(`    AND raw_lat BETWEEN $3-0.0003 AND $3+0.0003   -- ~33m bbox`);
  console.log(`    AND raw_lng BETWEEN $4-0.0004 AND $4+0.0004`);
  console.log(`    AND created_at >= now() - interval '180 days'`);
  console.log(`  -- then post-filter with Haversine for true ${SPOT_BUCKET_M}m radius.`);
  console.log();

  console.log('Recommended index (apply via dashboard):');
  console.log(`  CREATE INDEX IF NOT EXISTS idx_pd_user_carplay_uid_lat`);
  console.log(`    ON parking_diagnostics (user_id, (native_meta->>'carPlayPortUid'), raw_lat)`);
  console.log(`    WHERE native_meta->>'carPlayPortUid' IS NOT NULL;`);
  console.log();

  console.log('Re-run after design review: edit pages/api/mobile/check-parking.ts to add the lookup + bump.');
})().catch((e) => {
  console.error('Analysis failed:', e);
  process.exit(1);
});
