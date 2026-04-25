#!/usr/bin/env npx tsx
/**
 * Smoke test for the Metra/CTA 'L' rail-corridor parking guard.
 *
 * Runs three scenarios against
 * TicketlessChicagoMobile/src/services/RailCorridorGuard.ts:
 *   A. Synthetic Metra UP-N ride, Ravenswood → Ogilvie — expect SUPPRESS.
 *   B. Synthetic street drive along Ravenswood Ave (parallels UP-N) —
 *      expect NO suppress (car on parallel street, trajectory is shorter
 *      + slower).
 *   C. Point-only spot check: known Union Station / Ogilvie coords should
 *      register as "on rail corridor"; a coord a block east (Loop streets)
 *      should NOT.
 *
 * Replay mode: pass a path to a parking_decisions.ndjson file as argv[2];
 * the script will re-evaluate every onParkingDetected event in the file.
 *
 * Exit 0 iff every assertion passes.
 */

// RN globals needed before importing the guard (it imports Logger, which
// references __DEV__ at module-eval time). ES `import` statements are hoisted
// and would run before any top-level assignment, so we use require() for the
// guard after setting the flag.
(globalThis as any).__DEV__ = false;

import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const railGuard = require('../TicketlessChicagoMobile/src/services/RailCorridorGuard') as typeof import('../TicketlessChicagoMobile/src/services/RailCorridorGuard');
const { evaluateRailGuard, distanceToNearestRailMeters, isInRailCorridor, RAIL_GUARD_CONFIG } = railGuard;

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
const a = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

console.log(`Rail corridor dataset: v${RAIL_GUARD_CONFIG.DATASET_VERSION}, ${RAIL_GUARD_CONFIG.LINE_COUNT} lines, ${RAIL_GUARD_CONFIG.STATION_COUNT} stations`);
console.log(`Config: traj<=${RAIL_GUARD_CONFIG.TRAJ_RADIUS_M}m, long-trip>=${RAIL_GUARD_CONFIG.MIN_TRAJECTORY_DISTANCE_M}m @ ${RAIL_GUARD_CONFIG.MIN_RAIL_SPEED_MPS} m/s, short-hop>=${RAIL_GUARD_CONFIG.SHORT_HOP_MIN_DISTANCE_M}m @ ${RAIL_GUARD_CONFIG.SHORT_HOP_MIN_SPEED_MPS} m/s near station<=${RAIL_GUARD_CONFIG.STATION_RADIUS_M}m, frac ${RAIL_GUARD_CONFIG.TRAJECTORY_FRACTION_ON_RAIL}`);
console.log('');

// ---- Point spot checks --------------------------------------------------

// Union Station platforms (Canal + Adams area) — should hit rail.
{
  const d = distanceToNearestRailMeters(41.8789, -87.6402);
  a('Union Station tracks: within rail corridor', isInRailCorridor(41.8789, -87.6402), `${Math.round(d)}m`);
}
// Ogilvie Transportation Center throat — should hit rail.
{
  const d = distanceToNearestRailMeters(41.8823, -87.6403);
  a('Ogilvie throat: within rail corridor', isInRailCorridor(41.8823, -87.6403), `${Math.round(d)}m`);
}
// Clark & Fullerton (Lincoln Park) — ~1 km from any rail. Should NOT hit.
// (NB: Millennium Park itself is 5m from Metra Electric, so it's NOT a good
// "no-rail" control.)
{
  const d = distanceToNearestRailMeters(41.9237, -87.6385);
  a('Clark & Fullerton: NOT within rail corridor', !isInRailCorridor(41.9237, -87.6385), `${Math.round(d)}m`);
}

// ---- Scenario A: synthetic Metra UP-N ride ------------------------------
//
// Trajectory sampled directly from the OSM rail dataset along the UP-N /
// Clybourn → Ogilvie corridor (every ~1 km of latitude). Each point lies on
// actual rail. Speeds set to ~25–28 m/s (55–62 mph) mid-trip, decelerating
// into the terminal. This approximates what CoreMotion + GPS would produce
// during a real Metra ride.

const metraTrajectory = [
  { latitude: 41.99062, longitude: -87.67505, speed: 22.0, heading: 180 }, // Edgebrook area
  { latitude: 41.97986, longitude: -87.67478, speed: 26.0, heading: 180 },
  { latitude: 41.96895, longitude: -87.67448, speed: 28.0, heading: 180 }, // Ravenswood
  { latitude: 41.95799, longitude: -87.67418, speed: 28.0, heading: 180 },
  { latitude: 41.94853, longitude: -87.65360, speed: 28.0, heading: 170 },
  { latitude: 41.93893, longitude: -87.65317, speed: 27.0, heading: 175 },
  { latitude: 41.92881, longitude: -87.67309, speed: 25.0, heading: 190 }, // Clybourn
  { latitude: 41.91980, longitude: -87.67229, speed: 24.0, heading: 185 },
  { latitude: 41.91079, longitude: -87.66421, speed: 20.0, heading: 160 },
  { latitude: 41.90171, longitude: -87.65982, speed: 12.0, heading: 155 }, // approach
  { latitude: 41.89258, longitude: -87.64694, speed: 6.0, heading: 150 },
  { latitude: 41.88353, longitude: -87.63391, speed: 1.0, heading: 150 }, // at Ogilvie
];
const metraPark = { latitude: 41.88230, longitude: -87.64030 };

{
  const dec = evaluateRailGuard(metraPark, metraTrajectory);
  a(
    'Metra UP-N ride → SUPPRESS',
    dec.suppress,
    `park=${Math.round(dec.parkDistanceM)}m frac=${dec.fractionOnRail.toFixed(2)} dist=${Math.round(dec.trajectoryDistanceM)}m vmax=${dec.maxSpeedMps.toFixed(1)} reason=${dec.reason}`,
  );
}

// ---- Scenario B: car driving Ravenswood Ave parallel to UP-N ------------
//
// Ravenswood Ave runs within ~40-70m west of the UP-N embankment from
// Bryn Mawr south to Irving Park. A car crawling this stretch will register
// inside the 120m trajectory buffer. The guard should NOT suppress because:
//   (a) trajectory is short (~1.5 km of Ravenswood Ave), under the 3 km floor
//   (b) speeds are city-street (11 m/s = ~25 mph) — under the 17 m/s floor
// If EITHER check were missing, this would be a false positive. Both must hold.

const streetTrajectory = [
  { latitude: 41.98300, longitude: -87.67420, speed: 11.0, heading: 180 },
  { latitude: 41.98100, longitude: -87.67415, speed: 11.5, heading: 180 },
  { latitude: 41.97900, longitude: -87.67410, speed: 12.0, heading: 180 },
  { latitude: 41.97700, longitude: -87.67405, speed: 11.0, heading: 180 },
  { latitude: 41.97500, longitude: -87.67400, speed: 10.5, heading: 180 },
  { latitude: 41.97300, longitude: -87.67395, speed: 11.0, heading: 180 },
  { latitude: 41.97100, longitude: -87.67390, speed: 11.5, heading: 180 },
  { latitude: 41.97000, longitude: -87.67385, speed: 5.0, heading: 180 },
  { latitude: 41.96950, longitude: -87.67383, speed: 0.5, heading: 180 },
];
const streetPark = { latitude: 41.96950, longitude: -87.67383 };

{
  const dec = evaluateRailGuard(streetPark, streetTrajectory);
  a(
    'Ravenswood Ave parallel drive → NO suppress',
    !dec.suppress,
    `park=${Math.round(dec.parkDistanceM)}m frac=${dec.fractionOnRail.toFixed(2)} dist=${Math.round(dec.trajectoryDistanceM)}m vmax=${dec.maxSpeedMps.toFixed(1)} reason=${dec.reason}`,
  );
}

// ---- Scenario C: stopped AT a rail crossing (brief) ---------------------
//
// Parking coord at a grade crossing but trajectory perpendicular to rail
// (crossed over). Should NOT suppress — fraction on rail is only at the
// single crossing point.

const crossingTrajectory = [
  { latitude: 41.92000, longitude: -87.69500, speed: 10.0, heading: 90 },
  { latitude: 41.92000, longitude: -87.69000, speed: 11.0, heading: 90 },
  { latitude: 41.92000, longitude: -87.68500, speed: 11.0, heading: 90 },
  { latitude: 41.92000, longitude: -87.68000, speed: 9.0, heading: 90 },
  { latitude: 41.92000, longitude: -87.67500, speed: 5.0, heading: 90 },
  { latitude: 41.92000, longitude: -87.67300, speed: 0.3, heading: 90 }, // stopped near tracks
];
const crossingPark = { latitude: 41.92000, longitude: -87.67300 };

{
  const dec = evaluateRailGuard(crossingPark, crossingTrajectory);
  a(
    'Stopped at grade crossing → NO suppress',
    !dec.suppress,
    `park=${Math.round(dec.parkDistanceM)}m frac=${dec.fractionOnRail.toFixed(2)} dist=${Math.round(dec.trajectoryDistanceM)}m vmax=${dec.maxSpeedMps.toFixed(1)} reason=${dec.reason}`,
  );
}

// ---- Scenario D: missing trajectory is safe ----------------------------
{
  const dec = evaluateRailGuard(metraPark, undefined);
  a('Missing trajectory → NO suppress (fail-safe)', !dec.suppress, dec.reason);
}

// ---- Scenario E: recovery event far from rail --------------------------
//
// Trajectory still says "rail trip" — the user rode Metra. A parking coord
// 1+ km from rail is exotic (something walked the user a long way) but
// shouldn't override the trajectory verdict. This is the case the old
// hard park-radius gate broke for the Ravenswood event at 132m.
{
  const dec = evaluateRailGuard({ latitude: 41.97850, longitude: -87.71500 }, metraTrajectory);
  a('Trajectory is rail, park coord far from rail → SUPPRESS (trajectory wins)', dec.suppress, `park=${Math.round(dec.parkDistanceM)}m end=${Math.round(dec.endDistanceM)}m rule=${dec.rule}`);
}

// ---- Scenario F: Ravenswood walked-off (the actual user bug) -----------
//
// Real Ravenswood Metra parking event from the decision log:
// curLat=41.96872, curLng=-87.67613, 132m from rail. Trajectory ended on
// the platform (~20m from rail). Old guard wouldn't fire (park gate). New
// guard should fire.
{
  const trajectory = metraTrajectory; // ends ON Ogilvie tracks
  const ravenswoodWalkedOff = { latitude: 41.96872, longitude: -87.67613 };
  const dec = evaluateRailGuard(ravenswoodWalkedOff, trajectory);
  a(
    'Ravenswood walked-off (132m from rail) → SUPPRESS',
    dec.suppress,
    `park=${Math.round(dec.parkDistanceM)}m end=${Math.round(dec.endDistanceM)}m station=${Math.round(dec.stationDistanceM)}m rule=${dec.rule}`,
  );
}

// ---- Scenario G: short L hop ending at a station -----------------------
//
// CTA Brown Line: roughly Belmont → Fullerton, ~2.0 km. Speeds modest
// (12-15 m/s peak). Should suppress via short_hop_to_station rule.
//
// Picked points lie within the rail buffer for the Brown Line corridor.
{
  const lTrajectory = [
    { latitude: 41.93978, longitude: -87.65333, speed: 13.0, heading: 175 }, // Belmont station
    { latitude: 41.93600, longitude: -87.65320, speed: 16.0, heading: 175 },
    { latitude: 41.93200, longitude: -87.65310, speed: 17.0, heading: 175 }, // mid-hop top speed
    { latitude: 41.92800, longitude: -87.65300, speed: 16.0, heading: 175 },
    { latitude: 41.92600, longitude: -87.65290, speed: 8.0, heading: 175 },
    { latitude: 41.92520, longitude: -87.65280, speed: 0.5, heading: 175 }, // Fullerton platform
  ];
  const dec = evaluateRailGuard({ latitude: 41.92520, longitude: -87.65280 }, lTrajectory);
  a(
    'Short L hop ending at a station → SUPPRESS',
    dec.suppress,
    `dist=${Math.round(dec.trajectoryDistanceM)}m vmax=${dec.maxSpeedMps.toFixed(1)} station=${Math.round(dec.stationDistanceM)}m rule=${dec.rule}`,
  );
}

// ---- Scenario H: short *car* trip ending near a station --------------
//
// A 2 km car drive that happens to end within 250m of a CTA station —
// e.g. dropping someone off. Trajectory is on streets, not rails.
// Should NOT suppress: fraction-on-rail is the firewall.
{
  const carTraj = [
    { latitude: 41.93957, longitude: -87.66400, speed: 11.0, heading: 175 }, // Western Ave
    { latitude: 41.93500, longitude: -87.66400, speed: 12.0, heading: 175 },
    { latitude: 41.93000, longitude: -87.66400, speed: 12.0, heading: 175 },
    { latitude: 41.92500, longitude: -87.66400, speed: 11.0, heading: 175 },
    { latitude: 41.92500, longitude: -87.66000, speed: 8.0, heading: 90 }, // turn east
    { latitude: 41.92500, longitude: -87.65540, speed: 0.5, heading: 90 }, // park near Fullerton CTA
  ];
  const dec = evaluateRailGuard({ latitude: 41.92500, longitude: -87.65540 }, carTraj);
  a(
    'Car drive ending near a station (off rails) → NO suppress',
    !dec.suppress,
    `frac=${dec.fractionOnRail.toFixed(2)} dist=${Math.round(dec.trajectoryDistanceM)}m station=${Math.round(dec.stationDistanceM)}m rule=${dec.rule}`,
  );
}

// ---- Replay mode -------------------------------------------------------

const replayPath = process.argv[2];
if (replayPath) {
  console.log(`\nReplay mode: ${replayPath}\n`);
  const abs = path.resolve(replayPath);
  if (!fs.existsSync(abs)) {
    console.error(`file not found: ${abs}`);
    process.exit(2);
  }
  const lines = fs.readFileSync(abs, 'utf8').split('\n').filter(Boolean);
  let evaluated = 0;
  let suppressed = 0;
  for (const l of lines) {
    let row: any;
    try { row = JSON.parse(l); } catch { continue; }
    const ev = row.event || row.kind;
    const d = row.data || row.payload || row;
    if (ev !== 'onParkingDetected' && ev !== 'parking_detected') continue;
    const traj = d.driveTrajectory || d.drive_trajectory;
    const lat = d.latitude ?? d.lat;
    const lng = d.longitude ?? d.lng;
    if (lat == null || lng == null || !traj) continue;
    const dec = evaluateRailGuard({ latitude: lat, longitude: lng }, traj);
    evaluated++;
    if (dec.suppress) suppressed++;
    console.log(
      `  ${new Date(d.timestamp || row.ts || 0).toISOString()}  suppress=${dec.suppress}  ${dec.reason}`,
    );
  }
  console.log(`\nreplay: ${evaluated} events, ${suppressed} would-suppress`);
}

// ---- Report -------------------------------------------------------------

console.log('');
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
