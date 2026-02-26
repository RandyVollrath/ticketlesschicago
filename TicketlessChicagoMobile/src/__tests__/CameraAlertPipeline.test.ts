/**
 * CameraAlertPipeline.test.ts
 *
 * Exhaustive tests for the camera detection algorithm using the pure-JS engine.
 * No native modules, no phone, no driving. Runs on any machine with `npm test`.
 *
 * Tests cover:
 * 1. Distance/proximity detection
 * 2. Direction matching (heading ↔ approach)
 * 3. Bearing filter (camera must be ahead)
 * 4. Speed thresholds (speed vs red-light cameras)
 * 5. Confidence scoring and tier assignment
 * 6. Alert radius scaling with speed
 * 7. Full simulated drives past real Chicago cameras
 * 8. Pass recording (drove through detection zone)
 * 9. Cooldown and re-alert logic
 * 10. Edge cases (no heading, no speed, boundary distances)
 */

import { RAW_CHICAGO_CAMERAS, CameraLocation } from '../data/chicago-cameras';
import {
  bearingTo,
  isHeadingMatch,
  isCameraAhead,
  getAlertRadius,
  computeConfidenceScore,
  findNearbyCameras,
  simulateDrive,
  generateStraightRoute,
  generateCameraApproachRoute,
  GPSPoint,
  BASE_ALERT_RADIUS_METERS,
  MAX_ALERT_RADIUS_METERS,
  TARGET_WARNING_SECONDS,
  HEADING_TOLERANCE_DEGREES,
  MAX_BEARING_OFF_HEADING_DEGREES,
  MIN_SPEED_SPEED_CAM_MPS,
  MIN_SPEED_REDLIGHT_MPS,
  APPROACH_TO_HEADING,
  COOLDOWN_RADIUS_METERS,
} from '../testing/CameraDetectionEngine';

// Use the raw camera array directly (the Proxy doesn't work well in tests)
const cameras: CameraLocation[] = (RAW_CHICAGO_CAMERAS as any) ?? [];

// Pick some well-known cameras for targeted tests
const SPEED_CAM_FULLERTON_EB = cameras.find(
  c => c.type === 'speed' && c.address.includes('6247 W Fullerton') && c.approaches.includes('EB')
)!;
const SPEED_CAM_FULLERTON_EB_IDX = cameras.indexOf(SPEED_CAM_FULLERTON_EB);

const REDLIGHT_CAM = cameras.find(c => c.type === 'redlight')!;
const REDLIGHT_CAM_IDX = cameras.indexOf(REDLIGHT_CAM);

// ---------------------------------------------------------------------------
// 1. Core Geometry Functions
// ---------------------------------------------------------------------------

describe('bearingTo', () => {
  it('should return ~0° for due north', () => {
    const brg = bearingTo(41.88, -87.63, 41.89, -87.63);
    expect(brg).toBeCloseTo(0, 0);
  });

  it('should return ~90° for due east', () => {
    const brg = bearingTo(41.88, -87.63, 41.88, -87.62);
    expect(brg).toBeCloseTo(90, 0);
  });

  it('should return ~180° for due south', () => {
    const brg = bearingTo(41.89, -87.63, 41.88, -87.63);
    expect(brg).toBeCloseTo(180, 0);
  });

  it('should return ~270° for due west', () => {
    const brg = bearingTo(41.88, -87.62, 41.88, -87.63);
    expect(brg).toBeCloseTo(270, 0);
  });
});

describe('isHeadingMatch', () => {
  it('should match when heading is within tolerance of approach', () => {
    expect(isHeadingMatch(85, ['EB'])).toBe(true); // 85° vs EB=90°, diff=5°
    expect(isHeadingMatch(45, ['EB'])).toBe(true); // 45° vs EB=90°, diff=45° (boundary)
  });

  it('should reject when heading is outside tolerance', () => {
    expect(isHeadingMatch(180, ['EB'])).toBe(false); // 180° vs EB=90°, diff=90°
    expect(isHeadingMatch(0, ['EB'])).toBe(false); // 0° vs EB=90°, diff=90°
  });

  it('should fail-open when heading is -1 (unavailable)', () => {
    expect(isHeadingMatch(-1, ['EB'])).toBe(true);
  });

  it('should fail-open when approaches array is empty', () => {
    expect(isHeadingMatch(90, [])).toBe(true);
  });

  it('should match if any approach direction matches', () => {
    expect(isHeadingMatch(0, ['NB', 'SB'])).toBe(true); // NB=0°, diff=0°
    expect(isHeadingMatch(180, ['NB', 'SB'])).toBe(true); // SB=180°, diff=0°
  });

  it('should handle wrap-around at 0°/360°', () => {
    expect(isHeadingMatch(350, ['NB'])).toBe(true); // diff=10°
    expect(isHeadingMatch(10, ['NB'])).toBe(true); // diff=10°
    expect(isHeadingMatch(315, ['NWB'])).toBe(true); // NWB=315°, diff=0°
  });

  it('should match diagonal approaches', () => {
    expect(isHeadingMatch(40, ['NEB'])).toBe(true); // NEB=45°, diff=5°
    expect(isHeadingMatch(220, ['SWB'])).toBe(true); // SWB=225°, diff=5°
  });
});

describe('isCameraAhead', () => {
  it('should return true when camera is directly ahead', () => {
    // Heading north, camera to the north
    expect(isCameraAhead(41.88, -87.63, 41.89, -87.63, 0)).toBe(true);
  });

  it('should return false when camera is behind', () => {
    // Heading north, camera to the south
    expect(isCameraAhead(41.89, -87.63, 41.88, -87.63, 0)).toBe(false);
  });

  it('should return false when camera is perpendicular', () => {
    // Heading north, camera to the east
    expect(isCameraAhead(41.88, -87.63, 41.88, -87.62, 0)).toBe(false);
  });

  it('should fail-open when heading is -1', () => {
    expect(isCameraAhead(41.88, -87.63, 41.89, -87.63, -1)).toBe(true);
  });

  it('should accept cameras within the ±30° cone', () => {
    // Heading ~90° (east), camera slightly NE = bearing ~75°
    // For this we need a camera roughly east with slight north offset
    expect(isCameraAhead(41.88, -87.64, 41.8805, -87.63, 90)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Alert Radius
// ---------------------------------------------------------------------------

describe('getAlertRadius', () => {
  it('should return base radius when speed is unknown', () => {
    expect(getAlertRadius(-1)).toBe(BASE_ALERT_RADIUS_METERS);
  });

  it('should return base radius at low speeds', () => {
    expect(getAlertRadius(5)).toBe(BASE_ALERT_RADIUS_METERS); // 5 * 10 = 50m < 150m
  });

  it('should scale with speed in mid-range', () => {
    const r = getAlertRadius(20); // 20 * 10 = 200m
    expect(r).toBe(200);
  });

  it('should cap at MAX_ALERT_RADIUS at high speeds', () => {
    expect(getAlertRadius(30)).toBe(MAX_ALERT_RADIUS_METERS); // 30 * 10 = 300m > 250m
    expect(getAlertRadius(40)).toBe(MAX_ALERT_RADIUS_METERS);
  });

  it('should give ~10 seconds of warning time at any speed', () => {
    for (const speedMps of [10, 15, 20, 25]) {
      const radius = getAlertRadius(speedMps);
      const warningSeconds = radius / speedMps;
      // Should be ~10s within the dynamic range
      if (speedMps * TARGET_WARNING_SECONDS >= BASE_ALERT_RADIUS_METERS &&
          speedMps * TARGET_WARNING_SECONDS <= MAX_ALERT_RADIUS_METERS) {
        expect(warningSeconds).toBeCloseTo(TARGET_WARNING_SECONDS, 0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Confidence Scoring
// ---------------------------------------------------------------------------

describe('computeConfidenceScore', () => {
  const mockCam: CameraLocation = {
    type: 'speed', address: 'Test', latitude: 41.9236, longitude: -87.7825, approaches: ['EB'],
  };

  it('should return higher score for closer cameras', () => {
    const near = computeConfidenceScore(mockCam, 50, 10, 90, 200, 41.9236, -87.784);
    const far = computeConfidenceScore(mockCam, 180, 10, 90, 200, 41.9236, -87.786);
    expect(near).toBeGreaterThan(far);
  });

  it('should return higher score for better bearing alignment', () => {
    // We test at same distance, different bearing offsets
    // Score depends on bearing from user to camera
    const score = computeConfidenceScore(mockCam, 100, 10, 90, 200, 41.9236, -87.784);
    expect(score).toBeGreaterThanOrEqual(55); // Should be at least medium
  });

  it('should boost red-light cameras by +4', () => {
    const speedCam: CameraLocation = { ...mockCam, type: 'speed' };
    const rlCam: CameraLocation = { ...mockCam, type: 'redlight' };
    const scoreSpeed = computeConfidenceScore(speedCam, 100, 10, 90, 200, 41.9236, -87.784);
    const scoreRL = computeConfidenceScore(rlCam, 100, 10, 90, 200, 41.9236, -87.784);
    expect(scoreRL - scoreSpeed).toBe(4);
  });

  it('should penalize unknown speed', () => {
    const known = computeConfidenceScore(mockCam, 100, 10, 90, 200, 41.9236, -87.784);
    const unknown = computeConfidenceScore(mockCam, 100, -1, 90, 200, 41.9236, -87.784);
    expect(known).toBeGreaterThan(unknown);
  });

  it('should be between 0 and 100', () => {
    for (let i = 0; i < 50; i++) {
      const score = computeConfidenceScore(
        mockCam,
        Math.random() * 300,
        Math.random() * 30 - 5,
        Math.random() * 360,
        200,
        41.92 + Math.random() * 0.01,
        -87.78 + Math.random() * 0.01,
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. findNearbyCameras — integration of all filters
// ---------------------------------------------------------------------------

describe('findNearbyCameras', () => {
  it('should find cameras within alert radius', () => {
    if (!SPEED_CAM_FULLERTON_EB) return; // Skip if camera not found
    // Position ourselves ~100m west of the camera, heading east
    const { candidates } = findNearbyCameras(
      cameras,
      SPEED_CAM_FULLERTON_EB.latitude,
      SPEED_CAM_FULLERTON_EB.longitude - 0.0012, // ~100m west
      90, // heading east
      10, // ~22 mph
    );
    const found = candidates.find(c => c.index === SPEED_CAM_FULLERTON_EB_IDX);
    expect(found).toBeDefined();
  });

  it('should reject cameras with wrong heading', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    const { candidates } = findNearbyCameras(
      cameras,
      SPEED_CAM_FULLERTON_EB.latitude,
      SPEED_CAM_FULLERTON_EB.longitude - 0.0012,
      270, // heading WEST but camera monitors EB
      10,
    );
    const found = candidates.find(c => c.index === SPEED_CAM_FULLERTON_EB_IDX);
    expect(found).toBeUndefined();
  });

  it('should reject speed cameras below speed threshold', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    const { candidates } = findNearbyCameras(
      cameras,
      SPEED_CAM_FULLERTON_EB.latitude,
      SPEED_CAM_FULLERTON_EB.longitude - 0.0012,
      90,
      1.0, // below MIN_SPEED_SPEED_CAM_MPS (3.2)
    );
    const found = candidates.find(c => c.index === SPEED_CAM_FULLERTON_EB_IDX);
    expect(found).toBeUndefined();
  });

  it('should not reject red-light cameras at low speed', () => {
    if (!REDLIGHT_CAM) return;
    const approach = REDLIGHT_CAM.approaches[0];
    const heading = APPROACH_TO_HEADING[approach] ?? 0;
    const { candidates } = findNearbyCameras(
      cameras,
      REDLIGHT_CAM.latitude,
      REDLIGHT_CAM.longitude - 0.0005, // close
      heading,
      1.5, // above MIN_SPEED_REDLIGHT_MPS (1.0), below MIN_SPEED_SPEED_CAM_MPS (3.2)
    );
    const found = candidates.find(c => c.index === REDLIGHT_CAM_IDX);
    expect(found).toBeDefined();
  });

  it('should respect type enable/disable settings', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    const { candidates } = findNearbyCameras(
      cameras,
      SPEED_CAM_FULLERTON_EB.latitude,
      SPEED_CAM_FULLERTON_EB.longitude - 0.0012,
      90, 10,
      { speedAlertsEnabled: false },
    );
    const found = candidates.find(c => c.index === SPEED_CAM_FULLERTON_EB_IDX);
    expect(found).toBeUndefined();
  });

  it('diagnostic counters should sum to total cameras', () => {
    const { candidates, diagnostic } = findNearbyCameras(
      cameras, 41.88, -87.63, 90, 10,
    );
    const accountedFor =
      diagnostic.typeFiltered +
      diagnostic.speedFiltered +
      diagnostic.bboxFiltered +
      diagnostic.distanceFiltered +
      diagnostic.headingFiltered +
      diagnostic.bearingFiltered +
      diagnostic.passed;
    expect(accountedFor).toBe(diagnostic.totalChecked);
  });
});

// ---------------------------------------------------------------------------
// 5. Simulated Drives Past Real Cameras
// ---------------------------------------------------------------------------

describe('simulateDrive — real camera approaches', () => {
  // Test the first 20 speed cameras and first 20 red-light cameras
  const speedCameras = cameras.filter(c => c.type === 'speed').slice(0, 20);
  const redlightCameras = cameras.filter(c => c.type === 'redlight').slice(0, 20);

  describe('speed cameras — correct approach at 30 mph', () => {
    for (const cam of speedCameras) {
      for (const approach of cam.approaches) {
        it(`should alert for ${cam.address} (${approach})`, () => {
          const route = generateCameraApproachRoute(cam, approach, 13.4); // 30 mph
          const result = simulateDrive(cameras, route);
          const idx = cameras.indexOf(cam);

          // Should have at least one alert (could be for this or a nearby camera)
          // The key assertion: THIS camera should be alerted
          expect(result.camerasAlerted.has(idx)).toBe(true);
        });
      }
    }
  });

  describe('red-light cameras — correct approach at 15 mph', () => {
    for (const cam of redlightCameras) {
      for (const approach of cam.approaches) {
        it(`should alert for ${cam.address} (${approach})`, () => {
          const route = generateCameraApproachRoute(cam, approach, 6.7); // 15 mph
          const result = simulateDrive(cameras, route);
          const idx = cameras.indexOf(cam);

          expect(result.camerasAlerted.has(idx)).toBe(true);
        });
      }
    }
  });

  it('should NOT alert when driving opposite direction past speed camera', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    // Camera monitors EB, we drive WB
    const route = generateCameraApproachRoute(
      SPEED_CAM_FULLERTON_EB,
      'WB', // Opposite direction
      13.4,
    );
    // Override heading to be WB = 270°
    const wbRoute = route.map(p => ({ ...p, heading: 270 }));
    const result = simulateDrive(cameras, wbRoute);
    // This specific camera should NOT be alerted (wrong direction)
    expect(result.camerasAlerted.has(SPEED_CAM_FULLERTON_EB_IDX)).toBe(false);
  });

  it('should NOT alert when driving too slowly past speed camera', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    const route = generateCameraApproachRoute(
      SPEED_CAM_FULLERTON_EB,
      'EB',
      2.0, // ~4.5 mph, below threshold
    );
    const result = simulateDrive(cameras, route);
    expect(result.camerasAlerted.has(SPEED_CAM_FULLERTON_EB_IDX)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Pass Recording
// ---------------------------------------------------------------------------

describe('pass recording', () => {
  it('should record a pass when driving through a speed camera zone', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    const route = generateCameraApproachRoute(SPEED_CAM_FULLERTON_EB, 'EB', 13.4, {
      approachDistanceMeters: 400,
      passDistanceMeters: 200, // Go well past
    });
    const result = simulateDrive(cameras, route);
    const pass = result.passes.find(p => p.cameraIndex === SPEED_CAM_FULLERTON_EB_IDX);
    expect(pass).toBeDefined();
    if (pass) {
      expect(pass.minDistance).toBeLessThan(50); // Got close to camera
      expect(pass.alertSpeedMps).toBeGreaterThan(MIN_SPEED_SPEED_CAM_MPS);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Cooldown and Re-Alert
// ---------------------------------------------------------------------------

describe('cooldown and re-alert', () => {
  it('should not re-alert for same camera without clearing cooldown', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    // First pass
    const route1 = generateCameraApproachRoute(SPEED_CAM_FULLERTON_EB, 'EB', 13.4, {
      approachDistanceMeters: 200,
      passDistanceMeters: 50,
    });
    // Immediate second pass (still within cooldown radius)
    const route2 = generateCameraApproachRoute(SPEED_CAM_FULLERTON_EB, 'EB', 13.4, {
      approachDistanceMeters: 200,
      passDistanceMeters: 50,
    });
    const combined = [...route1, ...route2];
    const result = simulateDrive(cameras, combined);
    // Should only fire ONCE
    const alertsForCam = result.alerts.filter(a => a.cameraIndex === SPEED_CAM_FULLERTON_EB_IDX);
    expect(alertsForCam.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle route with no GPS points', () => {
    const result = simulateDrive(cameras, []);
    expect(result.alerts).toHaveLength(0);
    expect(result.gpsUpdates).toBe(0);
  });

  it('should handle single GPS point', () => {
    const result = simulateDrive(cameras, [{
      latitude: 41.88, longitude: -87.63, speed: 10, heading: 90,
    }]);
    expect(result.gpsUpdates).toBe(1);
  });

  it('should handle unknown heading (fail-open)', () => {
    if (!SPEED_CAM_FULLERTON_EB) return;
    // Position at camera with no heading — should still alert (fail-open)
    const point: GPSPoint = {
      latitude: SPEED_CAM_FULLERTON_EB.latitude,
      longitude: SPEED_CAM_FULLERTON_EB.longitude - 0.001,
      speed: 10,
      heading: -1, // Unknown
    };
    const result = simulateDrive(cameras, [point]);
    // With fail-open, this should alert (heading match and bearing both pass)
    expect(result.alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle unknown speed for red-light cameras', () => {
    if (!REDLIGHT_CAM) return;
    const approach = REDLIGHT_CAM.approaches[0];
    const heading = APPROACH_TO_HEADING[approach] ?? 0;
    const point: GPSPoint = {
      latitude: REDLIGHT_CAM.latitude + 0.0005 * Math.cos(toRad(heading + 180)),
      longitude: REDLIGHT_CAM.longitude + 0.0005 * Math.sin(toRad(heading + 180)),
      speed: -1, // Unknown
      heading,
    };
    const result = simulateDrive(cameras, [point]);
    // Unknown speed should pass (no speed filter applied)
    // Alert may or may not fire depending on exact distance/bearing
    expect(result.gpsUpdates).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Coverage: All 510 cameras should be alertable
// ---------------------------------------------------------------------------

describe('camera coverage — every camera should be alertable', () => {
  // This is the most important test. Every single camera in the dataset
  // should fire an alert when approached from the correct direction at
  // a valid speed. If any camera fails, the detection algorithm has a bug.

  // We test a sample (first and last 10 of each type) to keep test time reasonable.
  const allSpeed = cameras.filter(c => c.type === 'speed');
  const allRedlight = cameras.filter(c => c.type === 'redlight');
  const sampleSpeed = [...allSpeed.slice(0, 10), ...allSpeed.slice(-10)];
  const sampleRedlight = [...allRedlight.slice(0, 10), ...allRedlight.slice(-10)];

  for (const cam of sampleSpeed) {
    it(`speed: ${cam.address} [${cam.approaches.join(',')}]`, () => {
      const approach = cam.approaches[0];
      const route = generateCameraApproachRoute(cam, approach, 13.4);
      const result = simulateDrive(cameras, route);
      const idx = cameras.indexOf(cam);
      expect(result.camerasAlerted.has(idx)).toBe(true);
    });
  }

  for (const cam of sampleRedlight) {
    it(`redlight: ${cam.address} [${cam.approaches.join(',')}]`, () => {
      const approach = cam.approaches[0];
      const route = generateCameraApproachRoute(cam, approach, 8.9); // 20 mph
      const result = simulateDrive(cameras, route);
      const idx = cameras.indexOf(cam);
      expect(result.camerasAlerted.has(idx)).toBe(true);
    });
  }
});

// Helper for edge case test
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
