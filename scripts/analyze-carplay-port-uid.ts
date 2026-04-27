#!/usr/bin/env npx tsx
/**
 * Analyze unified vehicle_id coverage and revisit patterns to inform the
 * "vehicle-known-spot" confidence bump in pages/api/mobile/check-parking.ts.
 *
 * Background: starting 2026-04-27 we capture a unified per-vehicle
 * identifier from both platforms and persist it in
 * parking_diagnostics.native_meta as `vehicleId` (string),
 * `vehicleIdSource` ('carplay' | 'android_bt'), `vehicleName` (string).
 *
 *   iOS source = 'carplay'    : AVAudioSession port.uid (no entitlement
 *                                required; Apple does NOT expose VIN/speed/
 *                                fuel to third-party apps — portUid is the
 *                                closest stable per-vehicle identifier).
 *   Android source = 'android_bt' : configured BT MAC of the user's car.
 *
 * This script answers: how often is per-vehicle identification actually
 * happening, how many (user, vehicle, spot) triples have enough revisits
 * to be diagnostic, and what threshold + confidence delta the live lookup
 * should use.
 *
 * (File still named analyze-carplay-port-uid.ts to match the cron entry
 * already installed; the analysis itself is platform-agnostic.)
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
  console.log('=== Unified vehicle_id analytics ===');
  console.log(`Window: ${SINCE} → now`);
  console.log(`Spot bucket: ${SPOT_BUCKET_M}m\n`);

  const { count: totalCount, error: tErr } = await s
    .from('parking_diagnostics')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', SINCE);
  if (tErr) { console.error('Total count failed:', tErr.message); process.exit(1); }

  const { count: vCount, error: vErr } = await (s as any)
    .from('parking_diagnostics')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', SINCE)
    .not('native_meta->>vehicleId', 'is', null);
  if (vErr) { console.error('Vehicle count failed:', vErr.message); process.exit(1); }

  const coverage = totalCount ? ((vCount! / totalCount) * 100).toFixed(1) : '0';
  console.log(`Coverage: ${vCount}/${totalCount} parking diagnostics carry a vehicle_id (${coverage}%)\n`);

  if (!vCount || vCount === 0) {
    console.log('NO VEHICLE_ID DATA YET — feature may not have rolled out, or no users on');
    console.log('CarPlay/configured-BT drives. Re-run after parking_diagnostics has rows.');
    process.exit(0);
  }

  const { data: rows, error: rErr } = await (s as any)
    .from('parking_diagnostics')
    .select('user_id, raw_lat, raw_lng, snapped_lat, snapped_lng, native_meta, created_at')
    .gte('created_at', SINCE)
    .not('native_meta->>vehicleId', 'is', null)
    .order('created_at', { ascending: true })
    .limit(20000);
  if (rErr) { console.error('Pull failed:', rErr.message); process.exit(1); }

  console.log(`Pulled ${rows!.length} vehicle_id rows for in-memory analysis.\n`);

  // Coverage per source.
  const sourceCounts: Map<string, number> = new Map();
  for (const r of rows as any[]) {
    const src = r.native_meta?.vehicleIdSource ?? 'unknown';
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }
  console.log('Source split:');
  for (const [src, n] of sourceCounts) {
    const pctOfV = ((n / vCount) * 100).toFixed(1);
    console.log(`  ${src}: ${n} rows (${pctOfV}% of identified)`);
  }
  console.log();

  type Row = {
    user_id: string;
    lat: number;
    lng: number;
    vehicleId: string;
    vehicleIdSource: string;
    vehicleName: string | null;
    createdAt: string;
  };
  const byPair: Map<string, Row[]> = new Map();
  for (const r of rows as any[]) {
    if (!r.user_id) continue;
    const lat = r.snapped_lat ?? r.raw_lat;
    const lng = r.snapped_lng ?? r.raw_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const vehicleId = r.native_meta?.vehicleId;
    if (typeof vehicleId !== 'string' || vehicleId.length === 0) continue;
    const vehicleIdSource = r.native_meta?.vehicleIdSource ?? 'unknown';
    const vehicleName = r.native_meta?.vehicleName ?? null;
    const key = `${r.user_id}|${vehicleId}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push({ user_id: r.user_id, lat, lng, vehicleId, vehicleIdSource, vehicleName, createdAt: r.created_at });
  }

  type Spot = { lat: number; lng: number; visits: number };
  const spotsPerPair: Map<string, Spot[]> = new Map();
  for (const [key, parks] of byPair) {
    const spots: Spot[] = [];
    for (const p of parks) {
      let matched = false;
      for (const sp of spots) {
        if (haversineMeters(p.lat, p.lng, sp.lat, sp.lng) <= SPOT_BUCKET_M) {
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

  console.log(`Unique (user, vehicle_id) pairs: ${byPair.size}`);
  console.log(`Total distinct spots across all pairs: ${totalSpots}`);
  console.log(`Spots with ≥3 visits: ${spotsWith3PlusVisits} (${totalSpots ? ((spotsWith3PlusVisits / totalSpots) * 100).toFixed(1) : '0'}%)`);
  console.log(`Spots with ≥5 visits: ${spotsWith5PlusVisits} (${totalSpots ? ((spotsWith5PlusVisits / totalSpots) * 100).toFixed(1) : '0'}%)\n`);

  console.log('Distinct spots per (user, vehicle_id):');
  console.log(`  median=${pct(distinctSpotsPerPair, 50)}  p90=${pct(distinctSpotsPerPair, 90)}  max=${Math.max(...distinctSpotsPerPair, 0)}\n`);

  console.log('Visits per spot (all pairs pooled):');
  console.log(`  median=${pct(visitsPerSpot, 50)}  p90=${pct(visitsPerSpot, 90)}  max=${Math.max(...visitsPerSpot, 0)}\n`);

  // Anomalies.
  const vehicleIdToUsers: Map<string, Set<string>> = new Map();
  const userToVehicleIds: Map<string, Set<string>> = new Map();
  for (const key of byPair.keys()) {
    const [userId, vehicleId] = key.split('|');
    if (!vehicleIdToUsers.has(vehicleId)) vehicleIdToUsers.set(vehicleId, new Set());
    vehicleIdToUsers.get(vehicleId)!.add(userId);
    if (!userToVehicleIds.has(userId)) userToVehicleIds.set(userId, new Set());
    userToVehicleIds.get(userId)!.add(vehicleId);
  }

  const sharedVehicleIds = Array.from(vehicleIdToUsers.entries()).filter(([_, users]) => users.size > 1);
  const usersWithManyVehicleIds = Array.from(userToVehicleIds.entries()).filter(([_, ids]) => ids.size > 5);

  console.log('=== Anomalies ===');
  if (sharedVehicleIds.length > 0) {
    console.log(`⚠️  ${sharedVehicleIds.length} vehicle_ids appear across MULTIPLE users (id may not be stable per pairing as expected):`);
    for (const [vid, users] of sharedVehicleIds.slice(0, 5)) {
      console.log(`    ${vid.slice(0, 32)}... → ${users.size} users`);
    }
  } else {
    console.log('✅ No vehicle_id is shared across users — id appears stable per pairing.');
  }
  if (usersWithManyVehicleIds.length > 0) {
    console.log(`⚠️  ${usersWithManyVehicleIds.length} users have >5 distinct vehicle_ids (multi-vehicle households, or id churn?):`);
    for (const [u, ids] of usersWithManyVehicleIds.slice(0, 5)) {
      console.log(`    user=${u.slice(0, 8)}... → ${ids.size} distinct vehicle_ids`);
    }
  } else {
    console.log('✅ No user with >5 distinct vehicle_ids — single-vehicle pattern dominates.');
  }
  console.log();

  const medianVisits = pct(visitsPerSpot, 50);
  const recommendedThreshold = medianVisits >= 3 ? 5 : Math.max(3, medianVisits + 1);
  const recommendedDelta = recommendedThreshold >= 5 ? 12 : recommendedThreshold === 4 ? 9 : 6;

  console.log('=== Recommendation ===');
  console.log(`Threshold: ≥${recommendedThreshold} prior visits at the same spot in the same vehicle.`);
  console.log(`Confidence delta: +${recommendedDelta}  (reason: "vehicle-known-spot")`);
  console.log();

  console.log('Lookup query for check-parking.ts:');
  console.log(`  SELECT count(*) FROM parking_diagnostics`);
  console.log(`  WHERE user_id = $1`);
  console.log(`    AND native_meta->>'vehicleId' = $2`);
  console.log(`    AND raw_lat BETWEEN $3-0.0003 AND $3+0.0003   -- ~33m bbox`);
  console.log(`    AND raw_lng BETWEEN $4-0.0004 AND $4+0.0004`);
  console.log(`    AND created_at >= now() - interval '180 days'`);
  console.log(`  -- then post-filter with Haversine for true ${SPOT_BUCKET_M}m radius.`);
  console.log();

  console.log('Recommended index (apply via dashboard):');
  console.log(`  CREATE INDEX IF NOT EXISTS idx_pd_user_vehicle_id_lat`);
  console.log(`    ON parking_diagnostics (user_id, (native_meta->>'vehicleId'), raw_lat)`);
  console.log(`    WHERE native_meta->>'vehicleId' IS NOT NULL;`);
  console.log();

  console.log('Re-run after design review: edit pages/api/mobile/check-parking.ts to add the lookup + bump.');
})().catch((e) => {
  console.error('Analysis failed:', e);
  process.exit(1);
});
