/**
 * Smoke test for the kinematic calculator's GPS-augmented mode and the
 * full renderFindingsParagraph pipeline (statutory framework block,
 * Photo 1 spec-mismatch defense, GPS attestation).
 */

import { computeEnteredOnYellowArgument } from '../lib/red-light-kinematics';
import { renderFindingsParagraph } from '../lib/camera-evidence-pipeline';
import type { CameraEvidenceFindings } from '../lib/camera-evidence-analysis';

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

// ── Case 5: Full pipeline — findings + GPS + framework block ──
const baseFindings: CameraEvidenceFindings = {
  vehicle: {
    visiblePlate: 'FA81246',
    visiblePlateConfidence: 0.9,
    vehicleColor: 'black',
    vehicleBodyStyle: 'sedan',
    vehicleMakeModel: 'Honda Civic',
  },
  signal: {
    signalState: 'red',
    signalStateConfidence: 0.95,
    amberDurationSec: 3.0,
    timeIntoRedPhaseSec: 0.3,
    estimatedFeetPastStopBar: 20,
    postedSpeedLimitMph: 30,
    photo1FrontTiresPosition: 'before_stop_bar',
    photo1FrontTiresConfidence: 0.7,
  },
  scene: {
    visibleLocation: '7200 N Western Ave',
    weatherConditions: 'clear',
    noTurnOnRedSignVisible: 'unknown',
    otherSignsVisible: [],
  },
  contestable: [],
  recommendDefense: 'signal_state',
  summary: 'Vehicle in intersection, 0.3s into red, amber phase 3.0s.',
  analyzedAt: new Date().toISOString(),
};

const fullPipeline = renderFindingsParagraph(baseFindings, 'FA81246', null);
assert(!!fullPipeline, 'Full pipeline: returns a paragraph');
assert(fullPipeline!.includes('CONTROLLING LEGAL FRAMEWORK'), 'Full pipeline: includes statutory framework block');
assert(fullPipeline!.includes('625 ILCS 5/11-306(c)(1)'), 'Full pipeline: cites 11-306 verbatim');
assert(fullPipeline!.includes('625 ILCS 5/11-208.6(a)'), 'Full pipeline: cites 11-208.6 verbatim');
assert(fullPipeline!.includes('Processing Methods & Criteria'), 'Full pipeline: cites CDOT/DOF processing criteria');
assert(fullPipeline!.includes('vehicles that entered the intersection on yellow'), 'Full pipeline: quotes CDOT FAQ verbatim');
assert(fullPipeline!.includes('HEARING-OFFICER MATH NOTE'), 'Full pipeline: includes math note');

// ── Case 6: Photo 1 spec-mismatch defense ──
const photo1Mismatch: CameraEvidenceFindings = {
  ...baseFindings,
  signal: {
    ...baseFindings.signal!,
    photo1FrontTiresPosition: 'past_stop_bar',
    photo1FrontTiresConfidence: 0.85,
  },
};
const photo1Output = renderFindingsParagraph(photo1Mismatch, 'FA81246', null);
assert(!!photo1Output, 'Photo 1 mismatch: returns a paragraph');
assert(photo1Output!.includes('PROCESSING-CRITERIA FAILURE'), 'Photo 1 mismatch: includes spec-mismatch defense block');
assert(photo1Output!.includes('Photo 1 — shows the front tires of the vehicle BEFORE the stop bar'), 'Photo 1 mismatch: quotes CDOT spec verbatim');

// ── Case 7: GPS-only path still includes statutory block ──
const gpsOnly = renderFindingsParagraph(null, 'FA81246', {
  approachSpeedMph: 28.0,
  minSpeedMph: 0.0,
  fullStopDetected: true,
  fullStopDurationSec: 1.8,
  speedDeltaMph: 28.0,
  deviceTimestamp: '2026-02-04T13:21:07Z',
});
assert(!!gpsOnly, 'GPS-only: returns a paragraph');
assert(gpsOnly!.includes('INDEPENDENT GPS EVIDENCE'), 'GPS-only: includes GPS attestation');

console.log('\nAll smoke tests passed.\n');

console.log('--- Sample paragraph: GPS + full-stop (right-turn-on-red) ---\n');
console.log(gpsFullStop.paragraph);

console.log('\n\n--- Sample paragraph: full pipeline (framework + math + plate match) ---\n');
console.log(fullPipeline);

console.log('\n\n--- Sample paragraph: Photo 1 spec-mismatch defense ---\n');
console.log(photo1Output);
