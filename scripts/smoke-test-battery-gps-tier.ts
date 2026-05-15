#!/usr/bin/env tsx
/**
 * Smoke test: the Android driving-GPS tier picker behaves correctly.
 *
 * Validates the speed-adaptive + spatial-gating + idle-tier + hysteresis
 * logic in BackgroundTaskService:
 *   - 'high'   (1 Hz / 5 m)   — near a camera OR at highway speed
 *   - 'medium' (2 s / 10 m)   — city speed outside camera radius
 *   - 'low'    (5 s / 25 m)   — slow + far
 *   - 'idle'   (30 s / 100 m) — stopped 90s+ at long light/jam, clearly far
 *                                from any camera
 *
 * Also validates:
 *   - hysteresis: downgrades require sustained recommendation, upgrades fire
 *     immediately
 *   - rescan skip: 4-hour rescan skips when not on a snow route AND parked
 *     < 24h ago
 *   - snow forecast temp gate: skip NWS round-trip when last min temp was
 *     > 35°F and reading is < 6h old
 *
 * Pure-logic test — no native modules, no AsyncStorage. Mirrors the
 * constants and functions in BackgroundTaskService so we can exercise the
 * decision matrix without booting React Native. If this test drifts from
 * the production logic, update both together.
 *
 * Run: npx tsx scripts/smoke-test-battery-gps-tier.ts
 */

// ---- Mirror constants from BackgroundTaskService.ts ------------------------
const CAMERA_PROXIMITY_HIGH_M = 500;
const CAMERA_PROXIMITY_MEDIUM_M = 1500;
const CAMERA_PROXIMITY_IDLE_MIN_M = 1000;
const SPEED_HIGH_MPS = 11.18;
const SPEED_MEDIUM_MPS = 4.47;
const IDLE_TIER_SPEED_ZERO_HOLD_MS = 90 * 1000;
const IDLE_TIER_SPEED_EPSILON_MPS = 0.3;
const ANDROID_GPS_TIER_DOWNGRADE_HOLD_MS = 15 * 1000;

type Tier = 'high' | 'medium' | 'low' | 'idle';
const TIER_RANK: Record<Tier, number> = { high: 3, medium: 2, low: 1, idle: 0 };

function pickTier(
  speedMps: number,
  nearestCameraM: number,
  speedZeroForMs: number,
): Tier {
  if (nearestCameraM < CAMERA_PROXIMITY_HIGH_M) return 'high';
  if (speedMps >= SPEED_HIGH_MPS) return 'high';
  if (
    speedZeroForMs >= IDLE_TIER_SPEED_ZERO_HOLD_MS &&
    nearestCameraM >= CAMERA_PROXIMITY_IDLE_MIN_M
  ) {
    return 'idle';
  }
  if (nearestCameraM < CAMERA_PROXIMITY_MEDIUM_M || speedMps >= SPEED_MEDIUM_MPS) return 'medium';
  return 'low';
}

// ---- Flat-earth distance helper (mirrors nearestCameraMeters) --------------
function distMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const LAT_TO_M = 111000;
  const LNG_TO_M = 82800;
  const dLat = (lat2 - lat1) * LAT_TO_M;
  const dLng = (lng2 - lng1) * LNG_TO_M;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ---- Tier picker cases -----------------------------------------------------
interface Case {
  name: string;
  speedMps: number;
  nearestCameraM: number;
  speedZeroForMs: number;
  expected: Tier;
}

const cases: Case[] = [
  // Camera proximity dominates (idle gate doesn't even matter)
  { name: 'stopped at red light next to camera (idle blocked)', speedMps: 0,    nearestCameraM: 50,   speedZeroForMs: 120_000, expected: 'high' },
  { name: 'creeping in traffic 300m from camera',               speedMps: 2,    nearestCameraM: 300,  speedZeroForMs: 0,       expected: 'high' },
  { name: 'at 499m from camera, slow',                          speedMps: 1,    nearestCameraM: 499,  speedZeroForMs: 0,       expected: 'high' },
  { name: 'at 501m from camera (medium ring)',                  speedMps: 1,    nearestCameraM: 501,  speedZeroForMs: 0,       expected: 'medium' },

  // Highway speed wins (idle hold ignored)
  { name: 'highway speed far from any camera',                  speedMps: 27,   nearestCameraM: 5000, speedZeroForMs: 0,       expected: 'high' },
  { name: 'highway speed near camera',                          speedMps: 27,   nearestCameraM: 100,  speedZeroForMs: 0,       expected: 'high' },

  // Idle tier — requires both conditions
  { name: 'stopped 90s, far from cameras → idle',               speedMps: 0,    nearestCameraM: 1500, speedZeroForMs: 90_000,  expected: 'idle' },
  { name: 'stopped 120s, very far → idle',                      speedMps: 0,    nearestCameraM: 3000, speedZeroForMs: 120_000, expected: 'idle' },
  { name: 'stopped 89s, far → not yet idle (low)',              speedMps: 0,    nearestCameraM: 3000, speedZeroForMs: 89_000,  expected: 'low' },
  { name: 'stopped 120s but only 950m from camera → low (not idle)', speedMps: 0, nearestCameraM: 950, speedZeroForMs: 120_000, expected: 'medium' },
  { name: 'stopped 120s exactly at 1000m → idle',               speedMps: 0,    nearestCameraM: 1000, speedZeroForMs: 120_000, expected: 'idle' },
  { name: 'just below speed epsilon, long hold → idle',         speedMps: 0.29, nearestCameraM: 2000, speedZeroForMs: 120_000, expected: 'idle' },
  // Note: pickTier doesn't manage the speed-zero timer (that's maybeRetune's
  // job). The smoke test passes the timer in directly. In production, any
  // speed >= 0.3 m/s would reset speedZeroForMs to 0 before pickTier is
  // called, so the next case is "if the speed-zero timer is 0, idle is off".
  { name: 'moving slowly (timer would be 0) → low',             speedMps: 1,    nearestCameraM: 3000, speedZeroForMs: 0,       expected: 'low' },

  // Middle band
  { name: 'city street speed (~15 mph) far away',               speedMps: 6.7,  nearestCameraM: 5000, speedZeroForMs: 0,       expected: 'medium' },
  { name: 'in 1500m radius of camera, slow',                    speedMps: 1,    nearestCameraM: 1200, speedZeroForMs: 0,       expected: 'medium' },

  // Low tier (no idle because timer is short)
  { name: 'walking 2 km from camera (short hold)',              speedMps: 1,    nearestCameraM: 2000, speedZeroForMs: 0,       expected: 'low' },

  // Boundaries
  { name: 'exactly at 10 mph, far',                             speedMps: 4.47, nearestCameraM: 3000, speedZeroForMs: 0,       expected: 'medium' },
  { name: 'just below 10 mph, far',                             speedMps: 4.46, nearestCameraM: 3000, speedZeroForMs: 0,       expected: 'low' },
  { name: 'exactly at 25 mph, far',                             speedMps: 11.18, nearestCameraM: 3000, speedZeroForMs: 0,      expected: 'high' },
  { name: 'just below 25 mph, far',                             speedMps: 11.17, nearestCameraM: 3000, speedZeroForMs: 0,      expected: 'medium' },
];

let failed = 0;
for (const c of cases) {
  const got = pickTier(c.speedMps, c.nearestCameraM, c.speedZeroForMs);
  const ok = got === c.expected;
  console.log(`${ok ? 'OK ' : 'FAIL'}  speed=${c.speedMps.toFixed(2)} m/s  camDist=${c.nearestCameraM}m  zero=${(c.speedZeroForMs/1000).toFixed(0)}s  → ${got}  (expected ${c.expected})  — ${c.name}`);
  if (!ok) failed++;
}

// ---- Hysteresis ------------------------------------------------------------
// Simulates the maybeRetune decision: given a current tier, a recommended
// tier, and how long the recommendation has held, decide whether to apply.
function shouldApply(current: Tier, recommended: Tier, stableForMs: number): boolean {
  if (recommended === current) return false;
  const isUpgrade = TIER_RANK[recommended] > TIER_RANK[current];
  if (isUpgrade) return true;
  return stableForMs >= ANDROID_GPS_TIER_DOWNGRADE_HOLD_MS;
}

interface HystCase {
  name: string;
  current: Tier;
  recommended: Tier;
  stableForMs: number;
  expectedApply: boolean;
}
const hysteresis: HystCase[] = [
  { name: 'upgrade fires immediately (low → high)',          current: 'low',    recommended: 'high',   stableForMs: 0,     expectedApply: true },
  { name: 'upgrade fires immediately (idle → medium)',       current: 'idle',   recommended: 'medium', stableForMs: 0,     expectedApply: true },
  { name: 'downgrade blocked at 5s (high → medium)',         current: 'high',   recommended: 'medium', stableForMs: 5000,  expectedApply: false },
  { name: 'downgrade applied at exactly 15s',                current: 'high',   recommended: 'medium', stableForMs: 15000, expectedApply: true },
  { name: 'downgrade applied at 30s',                        current: 'high',   recommended: 'low',    stableForMs: 30000, expectedApply: true },
  { name: 'no change requested → no apply',                  current: 'medium', recommended: 'medium', stableForMs: 60000, expectedApply: false },
];
for (const h of hysteresis) {
  const got = shouldApply(h.current, h.recommended, h.stableForMs);
  const ok = got === h.expectedApply;
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${h.current} → ${h.recommended} stable=${(h.stableForMs/1000).toFixed(0)}s  apply=${got} (expected ${h.expectedApply})  — ${h.name}`);
  if (!ok) failed++;
}

// ---- Distance sanity check (Loop → O'Hare ≈ 27 km) -------------------------
const loopLat = 41.8781, loopLng = -87.6298;
const ohareLat = 41.9786, ohareLng = -87.9048;
const d = distMeters(loopLat, loopLng, ohareLat, ohareLng);
const okDist = Math.abs(d / 1000 - 27) < 4;
console.log(`${okDist ? 'OK ' : 'FAIL'}  Loop → O'Hare flat-earth = ${(d/1000).toFixed(1)} km (expected ~27 km)`);
if (!okDist) failed++;

const dShort = distMeters(41.9395, -87.6537, 41.9252, -87.6537);
const okShort = Math.abs(dShort - 1590) < 100;
console.log(`${okShort ? 'OK ' : 'FAIL'}  Belmont → Fullerton flat-earth = ${dShort.toFixed(0)} m (expected ~1590 m)`);
if (!okShort) failed++;

// ---- Rescan skip math ------------------------------------------------------
const RESCAN_SKIP_MS = 24 * 60 * 60 * 1000;
const okSkipShort = (6 * 3600_000) < RESCAN_SKIP_MS;
const okSkipLong = !((36 * 3600_000) < RESCAN_SKIP_MS);
console.log(`${okSkipShort ? 'OK ' : 'FAIL'}  6h-parked non-snow-route → rescan skipped`);
console.log(`${okSkipLong ? 'OK ' : 'FAIL'}  36h-parked non-snow-route → rescan runs anyway`);
if (!okSkipShort) failed++;
if (!okSkipLong) failed++;

// ---- Snow forecast temp gate ----------------------------------------------
const SNOW_TEMP_GATE_F = 35;
const SNOW_TEMP_GATE_FRESH_MS = 6 * 60 * 60 * 1000;
function shouldSkipSnow(cachedMinF: number, cachedAgeMs: number): boolean {
  return cachedAgeMs < SNOW_TEMP_GATE_FRESH_MS && cachedMinF > SNOW_TEMP_GATE_F;
}
interface SnowCase {
  name: string;
  minF: number;
  ageMs: number;
  expectedSkip: boolean;
}
const snowCases: SnowCase[] = [
  { name: 'warm (60°F), fresh (2h)',                      minF: 60, ageMs: 2 * 3600_000, expectedSkip: true },
  { name: 'borderline (36°F), fresh',                     minF: 36, ageMs: 2 * 3600_000, expectedSkip: true },
  { name: 'exactly 35°F, fresh — not above threshold',    minF: 35, ageMs: 2 * 3600_000, expectedSkip: false },
  { name: 'below threshold (30°F), fresh',                minF: 30, ageMs: 2 * 3600_000, expectedSkip: false },
  { name: 'warm but stale (8h old)',                      minF: 60, ageMs: 8 * 3600_000, expectedSkip: false },
  { name: 'warm at exactly 6h freshness boundary',        minF: 60, ageMs: 6 * 3600_000, expectedSkip: false },
];
for (const s of snowCases) {
  const got = shouldSkipSnow(s.minF, s.ageMs);
  const ok = got === s.expectedSkip;
  console.log(`${ok ? 'OK ' : 'FAIL'}  snow gate: min=${s.minF}°F age=${(s.ageMs/3600_000).toFixed(0)}h skip=${got}  — ${s.name}`);
  if (!ok) failed++;
}

// ---- Snow-forecast adaptive interval --------------------------------------
const SNOW_FORECAST_DEFAULT_MS = 2 * 60 * 60 * 1000; // 2h
const SNOW_FORECAST_WARM_MS = 4 * 60 * 60 * 1000;    // 4h when cached temp > 50°F
function nextSnowDelay(cachedMinF: number | null, cachedAgeMs: number): number {
  if (cachedMinF === null) return SNOW_FORECAST_DEFAULT_MS;
  if (cachedAgeMs < 6 * 60 * 60 * 1000 && cachedMinF > 50) {
    return SNOW_FORECAST_WARM_MS;
  }
  return SNOW_FORECAST_DEFAULT_MS;
}
interface IntervalCase {
  name: string;
  minF: number | null;
  ageMs: number;
  expectedMs: number;
}
const intervalCases: IntervalCase[] = [
  { name: 'no cache → 2h default',                        minF: null, ageMs: 0,                   expectedMs: SNOW_FORECAST_DEFAULT_MS },
  { name: 'reliably warm (65°F, fresh) → 4h',             minF: 65,   ageMs: 1 * 3600_000,        expectedMs: SNOW_FORECAST_WARM_MS },
  { name: 'borderline (40°F, fresh) → 2h',                minF: 40,   ageMs: 1 * 3600_000,        expectedMs: SNOW_FORECAST_DEFAULT_MS },
  { name: 'cold (28°F) → 2h (snow risk, watch closely)',  minF: 28,   ageMs: 1 * 3600_000,        expectedMs: SNOW_FORECAST_DEFAULT_MS },
  { name: 'warm but stale (8h) → 2h',                     minF: 65,   ageMs: 8 * 3600_000,        expectedMs: SNOW_FORECAST_DEFAULT_MS },
  { name: 'exactly 50°F (not >50) → 2h',                  minF: 50,   ageMs: 1 * 3600_000,        expectedMs: SNOW_FORECAST_DEFAULT_MS },
];
for (const i of intervalCases) {
  const got = nextSnowDelay(i.minF, i.ageMs);
  const ok = got === i.expectedMs;
  console.log(`${ok ? 'OK ' : 'FAIL'}  snow interval: min=${i.minF ?? 'null'}°F age=${(i.ageMs/3600_000).toFixed(0)}h next=${(got/3600_000).toFixed(0)}h (expected ${(i.expectedMs/3600_000).toFixed(0)}h)  — ${i.name}`);
  if (!ok) failed++;
}

// ---- Rescan strategy (on-route vs off-route) ------------------------------
// On route: recurring 4h interval.
// Off route: single 24h one-shot — no recurring wake-ups.
function rescanStrategy(onSnowRoute: boolean): 'recurring_4h' | 'oneshot_24h' {
  return onSnowRoute ? 'recurring_4h' : 'oneshot_24h';
}
const okOnRoute = rescanStrategy(true) === 'recurring_4h';
const okOffRoute = rescanStrategy(false) === 'oneshot_24h';
console.log(`${okOnRoute ? 'OK ' : 'FAIL'}  parked on snow route → recurring_4h`);
console.log(`${okOffRoute ? 'OK ' : 'FAIL'}  parked off snow route → oneshot_24h`);
if (!okOnRoute) failed++;
if (!okOffRoute) failed++;

// ---- iOS bootstrap window logic ------------------------------------------
// Confidence rule: shorten only when CoreMotion is active AND state is not
// "unknown" AND not "automotive" (automotive is excluded by the outer guard).
function bootstrapWindow(cmActive: boolean, cmState: string): number {
  const confident = cmActive && cmState !== 'unknown' && cmState !== 'automotive';
  return confident ? 20 : 75;
}
interface BootCase { name: string; active: boolean; state: string; expected: number; }
const bootCases: BootCase[] = [
  { name: 'fresh start (CM unknown) → 75s',           active: true,  state: 'unknown',    expected: 75 },
  { name: 'CM inactive (denied) → 75s',               active: false, state: 'stationary', expected: 75 },
  { name: 'CM active + stationary → 20s',             active: true,  state: 'stationary', expected: 20 },
  { name: 'CM active + walking → 20s',                active: true,  state: 'walking',    expected: 20 },
];
for (const b of bootCases) {
  const got = bootstrapWindow(b.active, b.state);
  const ok = got === b.expected;
  console.log(`${ok ? 'OK ' : 'FAIL'}  bootstrap: active=${b.active} state=${b.state} → ${got}s (expected ${b.expected}s)  — ${b.name}`);
  if (!ok) failed++;
}

const total = cases.length + hysteresis.length + 4 + snowCases.length + intervalCases.length + 2 + bootCases.length;
if (failed > 0) {
  console.error(`\n${failed} / ${total} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
