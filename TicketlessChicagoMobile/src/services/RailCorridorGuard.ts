/**
 * RailCorridorGuard
 *
 * Heuristic filter that suppresses parking-detection events triggered by Metra,
 * CTA 'L', South Shore, or Amtrak trips. CoreMotion classifies all passenger
 * rail as `automotive`, so without this guard a Metra ride downtown fires an
 * onParkingDetected event when the user exits at Ogilvie or Union.
 *
 * Why trajectory drives the decision (not the park coord):
 *   Real-world Ravenswood Metra parking events register ~130m from the rail
 *   centerline because GPS drifts at the platform and the averaged stop coord
 *   shifts toward whichever street the user starts walking on. So a hard "park
 *   coord must be within 100m of rail" gate eats real Metra trips. Instead we
 *   ask: did the *trip itself* look like a train ride?
 *
 * Suppression criteria:
 *   PRIMARY (all three required):
 *     1. Trajectory covers ≥ MIN_TRAJECTORY_DISTANCE_M end-to-end
 *     2. ≥ TRAJECTORY_FRACTION_ON_RAIL of trajectory points within
 *        TRAJ_RADIUS_M of rail centerline
 *     3. Max trajectory speed ≥ MIN_RAIL_SPEED_MPS (Metra hits 30+ m/s
 *        between stops; cars rarely sustain 17+ m/s while staying inside a
 *        ~120m rail buffer for 2.5+ km)
 *
 *   STATION OVERRIDE: a shorter trip (≥ 1.5km, ≥ 12 m/s) that ends within
 *     STATION_RADIUS_M of a known passenger rail station and has ≥80% of
 *     points on rails — handles short L hops (e.g. Belmont → Fullerton).
 *
 * Park-coord and station distances are recorded for diagnostics but the
 * decision rests on trajectory shape + station-anchored rules.
 *
 * Data: src/data/chicago-rail-corridor.json — OSM railway=rail|light_rail|
 * subway ways + railway=station|halt nodes in Chicago metro bbox, DP
 * simplified to 5m. Includes Metra (incl. UP/BNSF freight track they share)
 * and CTA 'L'.
 */

import Logger from '../utils/Logger';
import railData from '../data/chicago-rail-corridor.json';

const log = Logger.createLogger('RailCorridorGuard');

const TRAJ_RADIUS_M = 120;
const MIN_TRAJECTORY_DISTANCE_M = 2500;
const TRAJECTORY_FRACTION_ON_RAIL = 0.8;
const MIN_RAIL_SPEED_MPS = 17;
const STATION_RADIUS_M = 150;
const SHORT_HOP_MIN_DISTANCE_M = 1500;
const SHORT_HOP_MIN_SPEED_MPS = 14;

type LatLng = { latitude: number; longitude: number };
type TrajectoryPoint = { latitude: number; longitude: number; heading?: number; speed?: number };

interface RailData {
  version: string;
  bbox: number[];
  lines: number[][][];
  stations?: number[][];
}

const RAIL = railData as unknown as RailData;
const STATIONS: number[][] = RAIL.stations ?? [];

// Spatial grid index: 0.01° ≈ 1.1 km cells. Each rail segment lives in every
// cell it crosses. Lookup checks a 3x3 neighborhood to catch segments up to
// ~1 km away. Segment count: ~12k → with index lookup is sub-millisecond.
const GRID_STEP = 0.01;
type Segment = { a: [number, number]; b: [number, number] };
const railIndex = new Map<string, Segment[]>();
const stationIndex = new Map<string, [number, number][]>();

function buildIndex() {
  for (const line of RAIL.lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i] as [number, number];
      const b = line[i + 1] as [number, number];
      const y0 = Math.floor(Math.min(a[0], b[0]) / GRID_STEP);
      const y1 = Math.floor(Math.max(a[0], b[0]) / GRID_STEP);
      const x0 = Math.floor(Math.min(a[1], b[1]) / GRID_STEP);
      const x1 = Math.floor(Math.max(a[1], b[1]) / GRID_STEP);
      const seg: Segment = { a, b };
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = `${y},${x}`;
          const bucket = railIndex.get(key);
          if (bucket) bucket.push(seg);
          else railIndex.set(key, [seg]);
        }
      }
    }
  }
  for (const s of STATIONS) {
    const y = Math.floor(s[0] / GRID_STEP);
    const x = Math.floor(s[1] / GRID_STEP);
    const key = `${y},${x}`;
    const bucket = stationIndex.get(key);
    const pt: [number, number] = [s[0], s[1]];
    if (bucket) bucket.push(pt);
    else stationIndex.set(key, [pt]);
  }
}
buildIndex();

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointToSegmentMeters(plat: number, plng: number, a: [number, number], b: [number, number]): number {
  const latM = 111320;
  const lngM = 111320 * Math.cos((plat * Math.PI) / 180);
  const ax = (a[1] - plng) * lngM;
  const ay = (a[0] - plat) * latM;
  const bx = (b[1] - plng) * lngM;
  const by = (b[0] - plat) * latM;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(ax, ay);
  let t = -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.hypot(px, py);
}

export function distanceToNearestRailMeters(lat: number, lng: number): number {
  const y = Math.floor(lat / GRID_STEP);
  const x = Math.floor(lng / GRID_STEP);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = railIndex.get(`${y + dy},${x + dx}`);
      if (!bucket) continue;
      for (const seg of bucket) {
        const d = pointToSegmentMeters(lat, lng, seg.a, seg.b);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

export function distanceToNearestStationMeters(lat: number, lng: number): number {
  const y = Math.floor(lat / GRID_STEP);
  const x = Math.floor(lng / GRID_STEP);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = stationIndex.get(`${y + dy},${x + dx}`);
      if (!bucket) continue;
      for (const s of bucket) {
        const d = haversineMeters(lat, lng, s[0], s[1]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

export function isInRailCorridor(lat: number, lng: number, maxMeters = 100): boolean {
  return distanceToNearestRailMeters(lat, lng) <= maxMeters;
}

export interface RailGuardDecision {
  suppress: boolean;
  reason: string;
  parkDistanceM: number;
  endDistanceM: number;
  stationDistanceM: number;
  trajectoryDistanceM: number;
  fractionOnRail: number;
  maxSpeedMps: number;
  pointsChecked: number;
  rule: 'long_rail_trip' | 'short_hop_to_station' | 'no_trajectory' | 'no_match';
}

/**
 * Evaluate whether to suppress this parking event as a rail trip.
 *
 * Inputs match BackgroundTaskService's onParkingDetected event payload:
 * the final parking coord (averaged stop_start) and the driveTrajectory
 * array populated from `recentDrivingLocations` in
 * BackgroundLocationModule.swift.
 *
 * If trajectory is missing or too short to analyze, we refuse to suppress
 * (safe default) — the guard only fires with positive evidence.
 */
export function evaluateRailGuard(
  parkingCoord: LatLng,
  trajectory: TrajectoryPoint[] | undefined,
): RailGuardDecision {
  const parkDist = distanceToNearestRailMeters(parkingCoord.latitude, parkingCoord.longitude);

  const result: RailGuardDecision = {
    suppress: false,
    reason: '',
    parkDistanceM: parkDist,
    endDistanceM: Infinity,
    stationDistanceM: Infinity,
    trajectoryDistanceM: 0,
    fractionOnRail: 0,
    maxSpeedMps: 0,
    pointsChecked: 0,
    rule: 'no_trajectory',
  };

  if (!trajectory || trajectory.length < 4) {
    result.reason = `trajectory_too_short_n${trajectory?.length ?? 0}`;
    return result;
  }

  let totalDistance = 0;
  let onRail = 0;
  let maxSpeed = 0;
  for (let i = 0; i < trajectory.length; i++) {
    const p = trajectory[i];
    if (p.speed && p.speed > maxSpeed) maxSpeed = p.speed;
    const d = distanceToNearestRailMeters(p.latitude, p.longitude);
    if (d <= TRAJ_RADIUS_M) onRail++;
    if (i > 0) {
      const prev = trajectory[i - 1];
      totalDistance += haversineMeters(prev.latitude, prev.longitude, p.latitude, p.longitude);
    }
  }
  const fraction = onRail / trajectory.length;

  // The last trajectory point is the vehicle's stop point — much more reliable
  // than parkingCoord (which can drift toward where the user finishes walking).
  const lastPoint = trajectory[trajectory.length - 1];
  const endDist = distanceToNearestRailMeters(lastPoint.latitude, lastPoint.longitude);
  const stationDist = distanceToNearestStationMeters(lastPoint.latitude, lastPoint.longitude);

  result.trajectoryDistanceM = totalDistance;
  result.fractionOnRail = fraction;
  result.maxSpeedMps = maxSpeed;
  result.pointsChecked = trajectory.length;
  result.endDistanceM = endDist;
  result.stationDistanceM = stationDist;

  // Rule 1: long rail trip — the strong, framework-spanning case.
  if (
    totalDistance >= MIN_TRAJECTORY_DISTANCE_M &&
    fraction >= TRAJECTORY_FRACTION_ON_RAIL &&
    maxSpeed >= MIN_RAIL_SPEED_MPS
  ) {
    result.suppress = true;
    result.rule = 'long_rail_trip';
    result.reason =
      `long_rail_trip park${Math.round(parkDist)}m end${Math.round(endDist)}m station${Math.round(stationDist)}m ` +
      `frac${fraction.toFixed(2)} dist${Math.round(totalDistance)}m vmax${maxSpeed.toFixed(1)}mps`;
    return result;
  }

  // Rule 2: short hop ending near a passenger station (covers Belmont →
  // Fullerton-type L rides). Requires three things to align: trajectory
  // mostly on rails, a real distance covered (not a drive across the street),
  // and ending at an actual station node (not just within a rail buffer).
  if (
    totalDistance >= SHORT_HOP_MIN_DISTANCE_M &&
    fraction >= TRAJECTORY_FRACTION_ON_RAIL &&
    maxSpeed >= SHORT_HOP_MIN_SPEED_MPS &&
    stationDist <= STATION_RADIUS_M
  ) {
    result.suppress = true;
    result.rule = 'short_hop_to_station';
    result.reason =
      `short_hop_to_station station${Math.round(stationDist)}m end${Math.round(endDist)}m ` +
      `frac${fraction.toFixed(2)} dist${Math.round(totalDistance)}m vmax${maxSpeed.toFixed(1)}mps`;
    return result;
  }

  // No match — explain which gate failed for the long-rail rule (most common
  // path), so decision logs are diagnosable.
  result.rule = 'no_match';
  if (totalDistance < MIN_TRAJECTORY_DISTANCE_M) {
    result.reason = `trajectory_distance_${Math.round(totalDistance)}m_below_${MIN_TRAJECTORY_DISTANCE_M}m`;
  } else if (fraction < TRAJECTORY_FRACTION_ON_RAIL) {
    result.reason = `fraction_on_rail_${fraction.toFixed(2)}_below_${TRAJECTORY_FRACTION_ON_RAIL}`;
  } else if (maxSpeed < MIN_RAIL_SPEED_MPS) {
    result.reason = `max_speed_${maxSpeed.toFixed(1)}mps_below_${MIN_RAIL_SPEED_MPS}mps`;
  } else {
    result.reason = 'no_rule_matched';
  }
  return result;
}

export function logRailGuardDecision(decision: RailGuardDecision) {
  if (decision.suppress) {
    log.info('RAIL GUARD suppressing parking event', decision as unknown as Record<string, unknown>);
  } else {
    log.info('RAIL GUARD not suppressing', decision as unknown as Record<string, unknown>);
  }
}

export const RAIL_GUARD_CONFIG = {
  TRAJ_RADIUS_M,
  MIN_TRAJECTORY_DISTANCE_M,
  TRAJECTORY_FRACTION_ON_RAIL,
  MIN_RAIL_SPEED_MPS,
  STATION_RADIUS_M,
  SHORT_HOP_MIN_DISTANCE_M,
  SHORT_HOP_MIN_SPEED_MPS,
  DATASET_VERSION: RAIL.version,
  LINE_COUNT: RAIL.lines.length,
  STATION_COUNT: STATIONS.length,
};
