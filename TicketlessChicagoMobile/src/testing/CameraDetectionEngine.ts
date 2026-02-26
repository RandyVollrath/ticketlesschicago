/**
 * CameraDetectionEngine — Pure-JS camera alert algorithm for testing.
 *
 * Extracts the exact logic from CameraAlertService.ts without any native
 * dependencies (no TTS, no NativeEventEmitter, no AsyncStorage). This
 * allows exhaustive automated testing of the detection pipeline on any
 * machine — no phone, no simulator, no driving required.
 *
 * All constants, thresholds, and filter logic are identical to production.
 * If you change CameraAlertService, update this file to match.
 */

import { CameraLocation } from '../data/chicago-cameras';
import { distanceMeters, toRad } from '../utils/geo';

// ---------------------------------------------------------------------------
// Constants (must stay in sync with CameraAlertService.ts)
// ---------------------------------------------------------------------------

export const BASE_ALERT_RADIUS_METERS = 150;
export const MAX_ALERT_RADIUS_METERS = 250;
export const TARGET_WARNING_SECONDS = 10;
export const COOLDOWN_RADIUS_METERS = 400;
export const MIN_SPEED_SPEED_CAM_MPS = 3.2; // ~7 mph
export const MIN_SPEED_REDLIGHT_MPS = 1.0; // ~2 mph
export const MIN_ANNOUNCE_INTERVAL_MS = 5000;
export const BBOX_DEGREES = 0.0025; // ~280m at Chicago's latitude
export const HEADING_TOLERANCE_DEGREES = 45;
export const MAX_BEARING_OFF_HEADING_DEGREES = 30;
export const SPEED_CAMERA_ENFORCE_START_HOUR = 6;
export const SPEED_CAMERA_ENFORCE_END_HOUR = 23;
export const PASS_CAPTURE_DISTANCE_METERS = 35;
export const PASS_MOVED_AWAY_DELTA_METERS = 20;
export const REDLIGHT_PASS_CAPTURE_DISTANCE_METERS = 22;
export const REDLIGHT_PASS_MOVED_AWAY_DELTA_METERS = 28;

export const APPROACH_TO_HEADING: Record<string, number> = {
  NB: 0, NEB: 45, EB: 90, SEB: 135, SB: 180, SWB: 225, WB: 270, NWB: 315,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CameraConfidenceTier = 'high' | 'medium' | 'low';

export interface GPSPoint {
  latitude: number;
  longitude: number;
  speed: number;      // m/s, -1 = unknown
  heading: number;    // degrees 0-360, -1 = unknown
  accuracy?: number;  // meters (horizontal)
  timestamp?: number; // epoch ms
}

export interface CameraCandidate {
  index: number;
  camera: CameraLocation;
  distance: number;
  confidenceScore: number;
  confidenceTier: CameraConfidenceTier;
}

export interface AlertEvent {
  camera: CameraLocation;
  cameraIndex: number;
  distance: number;
  confidenceScore: number;
  confidenceTier: CameraConfidenceTier;
  gpsPoint: GPSPoint;
  alertRadius: number;
  timestamp: number;
}

export interface PassEvent {
  camera: CameraLocation;
  cameraIndex: number;
  minDistance: number;
  minSpeedMps: number;
  alertSpeedMps: number;
  timestamp: number;
}

export interface DiagnosticSnapshot {
  totalChecked: number;
  typeFiltered: number;
  speedFiltered: number;
  bboxFiltered: number;
  distanceFiltered: number;
  headingFiltered: number;
  bearingFiltered: number;
  passed: number;
  nearestRedlightDistance: number;
  nearestSpeedDistance: number;
}

export interface DriveSimulationResult {
  alerts: AlertEvent[];
  passes: PassEvent[];
  diagnostics: DiagnosticSnapshot[];
  gpsUpdates: number;
  camerasAlerted: Set<number>;
}

// ---------------------------------------------------------------------------
// Pure functions (exact mirrors of CameraAlertService methods)
// ---------------------------------------------------------------------------

export function bearingTo(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const dLng = toRad(lng2 - lng1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  const bearingRad = Math.atan2(y, x);
  return ((bearingRad * 180) / Math.PI + 360) % 360;
}

export function isHeadingMatch(heading: number, approaches: string[]): boolean {
  if (heading < 0) return true; // fail-open
  if (!approaches || approaches.length === 0) return true; // fail-open

  for (const approach of approaches) {
    const targetHeading = APPROACH_TO_HEADING[approach];
    if (targetHeading === undefined) return true; // unknown approach code — fail-open
    let diff = Math.abs(heading - targetHeading);
    if (diff > 180) diff = 360 - diff;
    if (diff <= HEADING_TOLERANCE_DEGREES) return true;
  }
  return false;
}

export function isCameraAhead(
  userLat: number, userLng: number,
  camLat: number, camLng: number,
  heading: number
): boolean {
  if (heading < 0) return true; // fail-open
  const brg = bearingTo(userLat, userLng, camLat, camLng);
  let diff = Math.abs(heading - brg);
  if (diff > 180) diff = 360 - diff;
  return diff <= MAX_BEARING_OFF_HEADING_DEGREES;
}

export function getBearingOffHeading(
  userLat: number, userLng: number,
  camLat: number, camLng: number,
  heading: number
): number | null {
  if (heading < 0) return null;
  const brg = bearingTo(userLat, userLng, camLat, camLng);
  let diff = Math.abs(heading - brg);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

export function getAlertRadius(speed: number): number {
  if (speed < 0) return BASE_ALERT_RADIUS_METERS;
  const dynamicRadius = speed * TARGET_WARNING_SECONDS;
  return Math.max(BASE_ALERT_RADIUS_METERS, Math.min(dynamicRadius, MAX_ALERT_RADIUS_METERS));
}

export function computeConfidenceScore(
  camera: CameraLocation,
  distanceToCamera: number,
  speedMps: number,
  heading: number,
  alertRadius: number,
  userLat: number,
  userLng: number,
): number {
  let score = 50;

  const distanceRatio = Math.max(0, Math.min(1, distanceToCamera / Math.max(alertRadius, 1)));
  score += Math.round((1 - distanceRatio) * 28);

  if (heading >= 0) {
    const bearingOff = getBearingOffHeading(userLat, userLng, camera.latitude, camera.longitude, heading);
    if (bearingOff !== null) {
      if (bearingOff <= 12) score += 14;
      else if (bearingOff <= 22) score += 8;
      else if (bearingOff <= 30) score += 3;
    }
  } else {
    score -= 6;
  }

  if (camera.type === 'redlight') score += 4;

  if (speedMps < 0) score -= 8;
  else if (speedMps < 1.2) score -= 6;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// findNearbyCameras — same as CameraAlertService.findNearbyCameras
// ---------------------------------------------------------------------------

export function findNearbyCameras(
  cameras: CameraLocation[],
  lat: number,
  lng: number,
  heading: number,
  speed: number,
  options?: {
    speedAlertsEnabled?: boolean;
    redLightAlertsEnabled?: boolean;
  }
): { candidates: CameraCandidate[]; diagnostic: DiagnosticSnapshot } {
  const speedEnabled = options?.speedAlertsEnabled ?? true;
  const redlightEnabled = options?.redLightAlertsEnabled ?? true;
  const alertRad = getAlertRadius(speed);

  let typeFiltered = 0;
  let speedFiltered = 0;
  let bboxFiltered = 0;
  let distanceFiltered = 0;
  let headingFiltered = 0;
  let bearingFiltered = 0;
  let nearestRedlightDistance = Infinity;
  let nearestSpeedDistance = Infinity;

  const latMin = lat - BBOX_DEGREES;
  const latMax = lat + BBOX_DEGREES;
  const lngMin = lng - BBOX_DEGREES;
  const lngMax = lng + BBOX_DEGREES;

  const results: CameraCandidate[] = [];

  for (let i = 0; i < cameras.length; i++) {
    const cam = cameras[i];

    // Type filter
    if (cam.type === 'speed' && !speedEnabled) { typeFiltered++; continue; }
    if (cam.type === 'redlight' && !redlightEnabled) { typeFiltered++; continue; }

    // Speed filter
    if (speed >= 0) {
      const minSpeed = cam.type === 'speed' ? MIN_SPEED_SPEED_CAM_MPS : MIN_SPEED_REDLIGHT_MPS;
      if (speed < minSpeed) { speedFiltered++; continue; }
    }

    // BBOX filter
    if (cam.latitude < latMin || cam.latitude > latMax) { bboxFiltered++; continue; }
    if (cam.longitude < lngMin || cam.longitude > lngMax) { bboxFiltered++; continue; }

    // Exact distance
    const distance = distanceMeters(lat, lng, cam.latitude, cam.longitude);

    if (cam.type === 'redlight' && distance < nearestRedlightDistance) {
      nearestRedlightDistance = distance;
    } else if (cam.type === 'speed' && distance < nearestSpeedDistance) {
      nearestSpeedDistance = distance;
    }

    if (distance <= alertRad) {
      // Direction filter
      if (!isHeadingMatch(heading, cam.approaches)) {
        headingFiltered++;
        continue;
      }

      // Bearing filter
      if (!isCameraAhead(lat, lng, cam.latitude, cam.longitude, heading)) {
        bearingFiltered++;
        continue;
      }

      const confidenceScore = computeConfidenceScore(cam, distance, speed, heading, alertRad, lat, lng);
      const confidenceTier: CameraConfidenceTier =
        confidenceScore >= 75 ? 'high' : confidenceScore >= 55 ? 'medium' : 'low';

      results.push({ index: i, camera: cam, distance, confidenceScore, confidenceTier });
    } else {
      distanceFiltered++;
    }
  }

  results.sort((a, b) => a.distance - b.distance);

  return {
    candidates: results,
    diagnostic: {
      totalChecked: cameras.length,
      typeFiltered,
      speedFiltered,
      bboxFiltered,
      distanceFiltered,
      headingFiltered,
      bearingFiltered,
      passed: results.length,
      nearestRedlightDistance,
      nearestSpeedDistance,
    },
  };
}

// ---------------------------------------------------------------------------
// Drive simulator — replays a sequence of GPS points through the full pipeline
// ---------------------------------------------------------------------------

export function simulateDrive(
  cameras: CameraLocation[],
  route: GPSPoint[],
  options?: {
    speedAlertsEnabled?: boolean;
    redLightAlertsEnabled?: boolean;
  }
): DriveSimulationResult {
  const alerts: AlertEvent[] = [];
  const passes: PassEvent[] = [];
  const diagnostics: DiagnosticSnapshot[] = [];
  const alertedCameras = new Map<number, { alertedAt: number }>();
  const passTracking = new Map<number, {
    minDistanceMeters: number;
    minSpeedMps: number;
    alertSpeedMps: number;
    alertTimestamp: number;
    hasBeenWithinPassDistance: boolean;
    sawAheadHeading: boolean;
    sawBehindHeading: boolean;
  }>();
  let lastAnnounceTime = 0;

  for (const point of route) {
    const now = point.timestamp ?? Date.now();

    // Clear cooldowns for distant cameras
    for (const [idx] of alertedCameras) {
      const cam = cameras[idx];
      const dist = distanceMeters(point.latitude, point.longitude, cam.latitude, cam.longitude);
      if (dist > COOLDOWN_RADIUS_METERS) {
        alertedCameras.delete(idx);
        passTracking.delete(idx);
      }
    }

    // Update pass tracking for alerted cameras
    for (const [idx, tracking] of passTracking) {
      const cam = cameras[idx];
      const dist = distanceMeters(point.latitude, point.longitude, cam.latitude, cam.longitude);
      if (dist < tracking.minDistanceMeters) {
        tracking.minDistanceMeters = dist;
        tracking.minSpeedMps = point.speed;
      }
      const captureDistance = cam.type === 'redlight'
        ? REDLIGHT_PASS_CAPTURE_DISTANCE_METERS
        : PASS_CAPTURE_DISTANCE_METERS;
      if (dist <= captureDistance) {
        tracking.hasBeenWithinPassDistance = true;
      }

      const bearingOff = getBearingOffHeading(
        point.latitude, point.longitude, cam.latitude, cam.longitude, point.heading
      );
      if (bearingOff !== null) {
        if (bearingOff <= MAX_BEARING_OFF_HEADING_DEGREES) tracking.sawAheadHeading = true;
        if (bearingOff >= 100) tracking.sawBehindHeading = true;
      }

      const movedAwayDelta = cam.type === 'redlight'
        ? REDLIGHT_PASS_MOVED_AWAY_DELTA_METERS
        : PASS_MOVED_AWAY_DELTA_METERS;
      const movedAway = dist - tracking.minDistanceMeters >= movedAwayDelta;

      if (tracking.hasBeenWithinPassDistance && movedAway) {
        const isRedlightPass = cam.type === 'redlight'
          ? tracking.sawAheadHeading && tracking.sawBehindHeading
          : true;
        if (isRedlightPass) {
          passes.push({
            camera: cam,
            cameraIndex: idx,
            minDistance: tracking.minDistanceMeters,
            minSpeedMps: tracking.minSpeedMps,
            alertSpeedMps: tracking.alertSpeedMps,
            timestamp: now,
          });
          passTracking.delete(idx);
        }
      }
    }

    // Find nearby cameras
    const { candidates, diagnostic } = findNearbyCameras(
      cameras, point.latitude, point.longitude, point.heading, point.speed, options
    );
    diagnostics.push(diagnostic);

    if (candidates.length === 0) continue;
    if (now - lastAnnounceTime < MIN_ANNOUNCE_INTERVAL_MS) continue;

    for (const candidate of candidates) {
      if (alertedCameras.has(candidate.index)) continue;
      if (candidate.confidenceTier === 'low') continue;

      const alertRadius = getAlertRadius(point.speed);
      alerts.push({
        camera: candidate.camera,
        cameraIndex: candidate.index,
        distance: candidate.distance,
        confidenceScore: candidate.confidenceScore,
        confidenceTier: candidate.confidenceTier,
        gpsPoint: point,
        alertRadius,
        timestamp: now,
      });

      alertedCameras.set(candidate.index, { alertedAt: now });

      // Init pass tracking
      const bearingOff = getBearingOffHeading(
        point.latitude, point.longitude,
        candidate.camera.latitude, candidate.camera.longitude,
        point.heading
      );
      const captureDistance = candidate.camera.type === 'redlight'
        ? REDLIGHT_PASS_CAPTURE_DISTANCE_METERS
        : PASS_CAPTURE_DISTANCE_METERS;
      passTracking.set(candidate.index, {
        minDistanceMeters: candidate.distance,
        minSpeedMps: point.speed,
        alertSpeedMps: point.speed,
        alertTimestamp: now,
        hasBeenWithinPassDistance: candidate.distance <= captureDistance,
        sawAheadHeading: bearingOff !== null && bearingOff <= MAX_BEARING_OFF_HEADING_DEGREES,
        sawBehindHeading: bearingOff !== null && bearingOff >= 100,
      });

      lastAnnounceTime = now;
      break; // Only one alert per GPS update
    }
  }

  return {
    alerts,
    passes,
    diagnostics,
    gpsUpdates: route.length,
    camerasAlerted: new Set(alerts.map(a => a.cameraIndex)),
  };
}

// ---------------------------------------------------------------------------
// Route generation helpers — create synthetic GPS traces
// ---------------------------------------------------------------------------

/**
 * Generate a straight-line drive route between two points.
 * Simulates GPS updates at the given interval with realistic speed.
 */
export function generateStraightRoute(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
  speedMps: number,
  options?: {
    gpsIntervalMs?: number;
    headingOverride?: number; // Use calculated heading if not provided
    speedJitterMps?: number;
    headingJitterDeg?: number;
  }
): GPSPoint[] {
  const intervalMs = options?.gpsIntervalMs ?? 1000;
  const speedJitter = options?.speedJitterMps ?? 0.3;
  const headingJitter = options?.headingJitterDeg ?? 2;

  const totalDistance = distanceMeters(startLat, startLng, endLat, endLng);
  const heading = options?.headingOverride ?? bearingTo(startLat, startLng, endLat, endLng);
  const durationMs = (totalDistance / speedMps) * 1000;
  const numPoints = Math.max(2, Math.ceil(durationMs / intervalMs));

  const points: GPSPoint[] = [];
  const startTime = Date.now();

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const lat = startLat + (endLat - startLat) * t;
    const lng = startLng + (endLng - startLng) * t;
    const spd = speedMps + (Math.random() - 0.5) * 2 * speedJitter;
    const hdg = (heading + (Math.random() - 0.5) * 2 * headingJitter + 360) % 360;

    points.push({
      latitude: lat,
      longitude: lng,
      speed: Math.max(0, spd),
      heading: hdg,
      accuracy: 5 + Math.random() * 10,
      timestamp: startTime + i * intervalMs,
    });
  }

  return points;
}

/**
 * Generate a route that approaches a camera from the correct direction,
 * passes it, and continues. Designed to guarantee an alert should fire.
 */
export function generateCameraApproachRoute(
  camera: CameraLocation,
  approachDirection: string,
  speedMps: number = 13.4, // ~30 mph
  options?: {
    approachDistanceMeters?: number;
    passDistanceMeters?: number;
    gpsIntervalMs?: number;
  }
): GPSPoint[] {
  const approachDist = options?.approachDistanceMeters ?? 400;
  const passDist = options?.passDistanceMeters ?? 100;
  const targetHeading = APPROACH_TO_HEADING[approachDirection];
  if (targetHeading === undefined) {
    throw new Error(`Unknown approach direction: ${approachDirection}`);
  }

  // Calculate start point: approachDist meters BEHIND the camera in the approach direction.
  // "Behind" means opposite to the approach direction.
  const reverseHeadingRad = toRad((targetHeading + 180) % 360);
  const R = 6371000;
  const camLatRad = toRad(camera.latitude);
  const camLngRad = toRad(camera.longitude);

  // Start point (behind camera)
  const dStart = approachDist / R;
  const startLat = Math.asin(
    Math.sin(camLatRad) * Math.cos(dStart) +
    Math.cos(camLatRad) * Math.sin(dStart) * Math.cos(reverseHeadingRad)
  ) * (180 / Math.PI);
  const startLng = (camLngRad + Math.atan2(
    Math.sin(reverseHeadingRad) * Math.sin(dStart) * Math.cos(camLatRad),
    Math.cos(dStart) - Math.sin(camLatRad) * Math.sin(toRad(startLat))
  )) * (180 / Math.PI);

  // End point (past camera)
  const forwardHeadingRad = toRad(targetHeading);
  const dEnd = passDist / R;
  const endLat = Math.asin(
    Math.sin(camLatRad) * Math.cos(dEnd) +
    Math.cos(camLatRad) * Math.sin(dEnd) * Math.cos(forwardHeadingRad)
  ) * (180 / Math.PI);
  const endLng = (camLngRad + Math.atan2(
    Math.sin(forwardHeadingRad) * Math.sin(dEnd) * Math.cos(camLatRad),
    Math.cos(dEnd) - Math.sin(camLatRad) * Math.sin(toRad(endLat))
  )) * (180 / Math.PI);

  return generateStraightRoute(startLat, startLng, endLat, endLng, speedMps, {
    headingOverride: targetHeading,
    gpsIntervalMs: options?.gpsIntervalMs ?? 1000,
  });
}
