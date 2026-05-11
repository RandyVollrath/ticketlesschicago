/**
 * Smoke test for the kinematic calculator's GPS-augmented mode.
 *
 * Confirms:
 *  1. Calculator runs without GPS (FA81246-style ticket — no app user) and
 *     produces a sound qualitative paragraph.
 *  2. Calculator runs WITH GPS data and produces a paragraph that includes
 *     the "INDEPENDENT GPS EVIDENCE" attestation block.
 *  3. Full-stop detection produces a right-turn-on-red defense block.
 *  4. Approach speed below posted limit gets used in the qualitative math
 *     (more honest than asserting posted speed).
 */

import { computeEnteredOnYellowArgument } from '../lib/red-light-kinematics';

function assert(cond: any, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

// ── Case 1: No GPS (existing FA81246 behavior, no app user) ──
const noGps = computeEnteredOnYellowArgument({
  amberSec: 3.0,
  timeIntoRedSec: 0.3,
  postedSpeedMph: 30,
  estimatedFeetPastStopBar: null,
});
assert(noGps.computed === true, 'No-GPS case: computed = true');
assert(noGps.usedUserAppGps === false, 'No-GPS case: usedUserAppGps = false');
assert(noGps.paragraph.includes('HEARING-OFFICER MATH NOTE'), 'No-GPS case: paragraph starts with math note');
assert(!noGps.paragraph.includes('INDEPENDENT GPS EVIDENCE'), 'No-GPS case: no GPS block');
assert(noGps.confidence === 0.7, 'No-GPS case: confidence = 0.7');

// ── Case 2: GPS present, no full-stop, approach speed below posted ──
const gpsBelowLimit = computeEnteredOnYellowArgument({
  amberSec: 3.0,
  timeIntoRedSec: 0.3,
  postedSpeedMph: 30,
  estimatedFeetPastStopBar: null,
  userAppGps: {
    approachSpeedMph: 28.4,
    minSpeedMph: 24.1,
    fullStopDetected: false,
    fullStopDurationSec: null,
    speedDeltaMph: 4.3,
    deviceTimestamp: '2026-02-04T13:21:07Z',
  },
});
assert(gpsBelowLimit.computed === true, 'GPS-below-limit case: computed = true');
assert(gpsBelowLimit.usedUserAppGps === true, 'GPS-below-limit case: usedUserAppGps = true');
assert(gpsBelowLimit.paragraph.includes('INDEPENDENT GPS EVIDENCE'), 'GPS-below-limit case: includes GPS attestation');
assert(gpsBelowLimit.paragraph.includes('28.4 mph'), 'GPS-below-limit case: uses measured 28.4 mph');
assert(!gpsBelowLimit.paragraph.includes('FULL-STOP CONFIRMED'), 'GPS-below-limit case: no full-stop block');
assert(gpsBelowLimit.confidence === 0.85, 'GPS-below-limit case: confidence bumped to 0.85');

// ── Case 3: GPS with full-stop (right-turn-on-red scenario) ──
const gpsFullStop = computeEnteredOnYellowArgument({
  amberSec: 3.0,
  timeIntoRedSec: 0.4,
  postedSpeedMph: 30,
  estimatedFeetPastStopBar: null,
  userAppGps: {
    approachSpeedMph: 22.1,
    minSpeedMph: 0.0,
    fullStopDetected: true,
    fullStopDurationSec: 2.3,
    speedDeltaMph: 22.1,
    deviceTimestamp: '2026-02-04T13:21:07Z',
  },
});
assert(gpsFullStop.paragraph.includes('FULL-STOP CONFIRMED BY GPS'), 'Full-stop case: includes right-turn-on-red block');
assert(gpsFullStop.paragraph.includes('2.3 seconds'), 'Full-stop case: includes 2.3-second duration');
assert(gpsFullStop.paragraph.includes('625 ILCS 5/11-306(c)(1)'), 'Full-stop case: cites right-turn statute');

// ── Case 4: GPS + numeric distance (full math + GPS augmentation) ──
const gpsWithDistance = computeEnteredOnYellowArgument({
  amberSec: 3.0,
  timeIntoRedSec: 0.3,
  postedSpeedMph: 30,
  estimatedFeetPastStopBar: 20,
  userAppGps: {
    approachSpeedMph: 29.0,
    minSpeedMph: 18.0,
    fullStopDetected: false,
    fullStopDurationSec: null,
    speedDeltaMph: 11.0,
    deviceTimestamp: null,
  },
});
assert(gpsWithDistance.paragraph.includes('SCENARIO A'), 'GPS+distance case: includes scenario breakdown');
assert(gpsWithDistance.paragraph.includes('INDEPENDENT GPS EVIDENCE'), 'GPS+distance case: includes GPS attestation');
assert(gpsWithDistance.usedUserAppGps === true, 'GPS+distance case: usedUserAppGps = true');
assert(gpsWithDistance.confidence > 0.7, 'GPS+distance case: confidence elevated by GPS');

console.log('\nAll smoke tests passed.\n');

console.log('--- Sample paragraph: GPS + full-stop (right-turn-on-red) ---\n');
console.log(gpsFullStop.paragraph);
