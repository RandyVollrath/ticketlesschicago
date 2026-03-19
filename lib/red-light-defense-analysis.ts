/**
 * Red-Light Camera Defense Analysis
 *
 * Analyzes GPS/sensor data from red-light camera receipts to build
 * additional defense arguments beyond basic full-stop detection:
 *
 * 1. Yellow Light Timing Analysis — ITE/MUTCD standards vs Chicago actuals
 * 2. Right-Turn-on-Red Detection — GPS heading change analysis
 * 3. Intersection Geometry — approach distance, stop bar estimation
 * 4. Weather/Visibility Conditions — conditions at violation time
 * 5. Violation Spike Detection — abnormal daily violation counts (camera malfunction)
 * 6. Dilemma Zone Analysis — physics-based can't-stop/can't-clear analysis
 * 7. Late Notice Detection — 625 ILCS 5/11-208.6 mailing deadline
 * 8. Factual Inconsistency Check — plate/vehicle mismatch on notice
 *
 * All analysis is deterministic and based on publicly available standards.
 */

import {
  getHourlyWeatherAtTime,
  type HourlyWeatherAtViolation,
} from './weather-service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TracePoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  speedMps: number;
  speedMph: number;
  heading: number;
  horizontalAccuracyMeters: number | null;
}

export interface YellowLightAnalysis {
  /** Posted speed limit at this intersection (mph) */
  postedSpeedMph: number;
  /** ITE-recommended yellow duration based on approach speed (seconds) */
  iteRecommendedSec: number;
  /** Chicago's actual yellow duration for this speed (seconds) */
  chicagoActualSec: number;
  /** Difference: ITE recommended minus Chicago actual (positive = Chicago is shorter) */
  shortfallSec: number;
  /** Whether Chicago's yellow is shorter than ITE recommends */
  isShorterThanStandard: boolean;
  /** The driver's actual approach speed used for calculation (mph) */
  driverApproachSpeedMph: number;
  /** ITE recommended duration based on driver's actual speed (not posted limit) */
  iteForDriverSpeedSec: number;
  /** Human-readable explanation */
  explanation: string;
  /** Legal citation for the standard */
  standardCitation: string;
}

export interface RightTurnAnalysis {
  /** Whether a right turn was detected */
  rightTurnDetected: boolean;
  /** Total heading change (degrees, positive = clockwise/right) */
  headingChangeDeg: number;
  /** Duration of the turn maneuver (seconds) */
  turnDurationSec: number;
  /** The trace indices spanning the turn */
  turnStartIdx: number;
  turnEndIdx: number;
  /** Whether the vehicle stopped before turning (Illinois requires this) */
  stoppedBeforeTurn: boolean;
  /** Minimum speed during the turn approach (mph) */
  minSpeedBeforeTurnMph: number;
  /** Human-readable explanation */
  explanation: string;
  /** Whether this qualifies as a legal right-on-red (stopped + right turn) */
  isLegalRightOnRed: boolean;
}

export interface IntersectionGeometry {
  /** Estimated distance from first trace point to camera (meters) */
  approachDistanceMeters: number;
  /** Estimated time from first trace point to camera (seconds) */
  approachTimeSec: number;
  /** Average approach speed (mph) */
  averageApproachSpeedMph: number;
  /** Distance from the closest trace point to camera (meters) — proxy for stop bar */
  closestPointToCamera: number;
  /** Human-readable summary */
  summary: string;
}

/** Re-export weather type from weather-service for backward compatibility */
export type WeatherAtViolation = HourlyWeatherAtViolation;

export interface RedLightDefenseAnalysis {
  /** Yellow light timing analysis */
  yellowLight: YellowLightAnalysis | null;
  /** Right-turn-on-red detection */
  rightTurn: RightTurnAnalysis | null;
  /** Intersection geometry */
  geometry: IntersectionGeometry | null;
  /** Weather at violation time */
  weather: WeatherAtViolation | null;
  /** Violation spike / camera malfunction analysis */
  violationSpike: ViolationSpikeAnalysis | null;
  /** Dilemma zone analysis */
  dilemmaZone: DilemmaZoneAnalysis | null;
  /** Late notice analysis (90-day statutory deadline) */
  lateNotice: LateNoticeAnalysis | null;
  /** Factual inconsistency check (plate/state mismatch) */
  factualInconsistency: FactualInconsistencyAnalysis | null;
  /** Combined defense strength (0-100) */
  overallDefenseScore: number;
  /** Ordered list of defense arguments, strongest first */
  defenseArguments: DefenseArgument[];
}

export interface DefenseArgument {
  type: 'yellow_timing' | 'right_turn' | 'full_stop' | 'weather' | 'geometry' | 'deceleration' |
        'violation_spike' | 'dilemma_zone' | 'late_notice' | 'factual_inconsistency';
  strength: 'strong' | 'moderate' | 'supporting';
  title: string;
  summary: string;
  details: string;
}

export interface ViolationSpikeAnalysis {
  /** Daily violation count at this camera on the violation date */
  violationsOnDate: number;
  /** Average daily violations at this camera (30-day window) */
  averageDailyViolations: number;
  /** Ratio of violation-date count to average (>3x is suspicious) */
  spikeRatio: number;
  /** Whether this represents an anomalous spike */
  isSpike: boolean;
  /** Human-readable explanation */
  explanation: string;
}

export interface DilemmaZoneAnalysis {
  /** Whether the driver was in the dilemma zone at yellow onset */
  inDilemmaZone: boolean;
  /** Estimated stopping distance at approach speed (feet) */
  stoppingDistanceFt: number;
  /** Estimated distance to stop bar at yellow onset (feet) */
  distanceToStopBarFt: number;
  /** Estimated distance to clear intersection (feet) */
  distanceToClearFt: number;
  /** Whether driver could safely stop */
  canStop: boolean;
  /** Whether driver could clear intersection before red */
  canClear: boolean;
  /** Human-readable explanation */
  explanation: string;
}

export interface LateNoticeAnalysis {
  /** Days between violation date and notice issue date */
  daysBetween: number;
  /** Whether notice was sent after 90-day statutory deadline */
  exceeds90Days: boolean;
  /** Human-readable explanation */
  explanation: string;
}

export interface FactualInconsistencyAnalysis {
  /** Whether any inconsistency was found */
  hasInconsistency: boolean;
  /** Type of inconsistency (plate_mismatch, state_mismatch, etc.) */
  inconsistencyType: string | null;
  /** Human-readable explanation */
  explanation: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * ITE/MUTCD Yellow Light Duration Formula
 *
 * Y = t + v / (2 * (a + g * G))
 *
 * Where:
 *   t = perception-reaction time (1.0 seconds per ITE)
 *   v = approach speed (ft/s)
 *   a = deceleration rate (10 ft/s² per ITE, comfortable)
 *   g = gravitational acceleration (32.2 ft/s²)
 *   G = grade (0 for flat, positive uphill)
 *
 * Simplified for flat grade: Y = 1.0 + v / 20
 * Where v = speed in ft/s = mph * 1.467
 */
const ITE_PERCEPTION_REACTION_SEC = 1.0;
const ITE_DECEL_RATE_FT_PER_SEC2 = 10.0;
const MPH_TO_FPS = 1.467; // 1 mph = 1.467 ft/s

/**
 * Chicago yellow light durations by posted speed.
 * These are known from engineering reports and the 2014 Xerox investigation.
 * Chicago uses 3.0s at ≤30 mph — ITE recommends 3.5s.
 * The 2014 scandal involved reducing yellow from 3.0s to 2.9s at some intersections,
 * generating 77,000 extra tickets (~$7.7M revenue).
 */
const CHICAGO_YELLOW_DURATIONS: Record<number, number> = {
  25: 3.0,
  30: 3.0,
  35: 4.0,
  40: 4.0,
  45: 4.5,
  50: 5.0,
  55: 5.5,
};

/**
 * Earth radius in meters (WGS84 mean)
 */
const EARTH_RADIUS_M = 6_371_000;

// ─── Yellow Light Timing Analysis ────────────────────────────────────────────

/**
 * Calculate ITE-recommended yellow light duration for a given approach speed.
 * Uses the simplified ITE formula: Y = 1.0 + (v_fps) / (2 * 10) = 1.0 + v_fps/20
 */
function iteYellowDuration(approachSpeedMph: number): number {
  const vFps = approachSpeedMph * MPH_TO_FPS;
  return ITE_PERCEPTION_REACTION_SEC + vFps / (2 * ITE_DECEL_RATE_FT_PER_SEC2);
}

/**
 * Get Chicago's yellow light duration for a given posted speed.
 * Interpolates/rounds to nearest known value.
 */
function chicagoYellowDuration(postedSpeedMph: number): number {
  if (postedSpeedMph <= 30) return 3.0;
  if (postedSpeedMph <= 35) return 4.0;
  if (postedSpeedMph <= 40) return 4.0;
  if (postedSpeedMph <= 45) return 4.5;
  if (postedSpeedMph <= 50) return 5.0;
  return 5.5;
}

export function analyzeYellowLightTiming(
  postedSpeedMph: number,
  driverApproachSpeedMph: number | null,
): YellowLightAnalysis {
  const effectiveApproachSpeed = driverApproachSpeedMph ?? postedSpeedMph;
  const iteRecommended = iteYellowDuration(postedSpeedMph);
  const iteForDriverSpeed = iteYellowDuration(effectiveApproachSpeed);
  const chicagoActual = chicagoYellowDuration(postedSpeedMph);
  const shortfall = iteRecommended - chicagoActual;

  let explanation: string;
  if (shortfall > 0.3) {
    explanation = `Chicago's yellow light at this ${postedSpeedMph} mph intersection is ${chicagoActual.toFixed(1)} seconds — ` +
      `${shortfall.toFixed(1)} seconds shorter than the ${iteRecommended.toFixed(1)} seconds recommended by the Institute of ` +
      `Transportation Engineers (ITE) and MUTCD standards. This means drivers have less time to safely clear the intersection ` +
      `than national engineering standards prescribe. ` +
      `A 2014 Chicago Inspector General investigation found that similar yellow light shortfalls generated tens of thousands of ` +
      `citations that would not have been issued under proper timing.`;
  } else if (shortfall > 0) {
    explanation = `Chicago's yellow light at this ${postedSpeedMph} mph intersection is ${chicagoActual.toFixed(1)} seconds, ` +
      `which is ${shortfall.toFixed(1)} seconds shorter than the ITE-recommended ${iteRecommended.toFixed(1)} seconds. ` +
      `While a small difference, this reduces the margin of safety for drivers approaching at the posted speed.`;
  } else {
    explanation = `Chicago's yellow light timing of ${chicagoActual.toFixed(1)} seconds at this ${postedSpeedMph} mph intersection ` +
      `meets or exceeds the ${iteRecommended.toFixed(1)}-second ITE recommended minimum.`;
  }

  return {
    postedSpeedMph,
    iteRecommendedSec: parseFloat(iteRecommended.toFixed(1)),
    chicagoActualSec: chicagoActual,
    shortfallSec: parseFloat(shortfall.toFixed(2)),
    isShorterThanStandard: shortfall > 0.05,
    driverApproachSpeedMph: effectiveApproachSpeed,
    iteForDriverSpeedSec: parseFloat(iteForDriverSpeed.toFixed(1)),
    explanation,
    standardCitation: 'ITE Traffic Engineering Handbook (7th Ed.), MUTCD §4D.26, Illinois Vehicle Code 625 ILCS 5/11-306',
  };
}

// ─── Right-Turn-on-Red Detection ─────────────────────────────────────────────

/**
 * Calculate the signed heading change between two headings (degrees).
 * Positive = clockwise (right turn), negative = counter-clockwise (left turn).
 */
function headingChange(from: number, to: number): number {
  let diff = to - from;
  // Normalize to [-180, 180]
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

/**
 * Analyze GPS trace for right-turn-on-red pattern.
 * A right turn is detected when:
 *   - Heading changes by 60-120 degrees clockwise over consecutive readings
 *   - The turn occurs within a short time window (< 15 seconds)
 */
export function analyzeRightTurn(trace: TracePoint[]): RightTurnAnalysis | null {
  if (trace.length < 4) return null;

  // Look for cumulative heading change windows
  let bestTurnStart = -1;
  let bestTurnEnd = -1;
  let bestHeadingChange = 0;

  for (let i = 0; i < trace.length - 2; i++) {
    let cumulativeChange = 0;
    for (let j = i + 1; j < trace.length && j < i + 15; j++) {
      const change = headingChange(trace[j - 1].heading, trace[j].heading);
      cumulativeChange += change;

      // Check for right turn (60-150 degrees clockwise)
      if (cumulativeChange >= 60 && cumulativeChange <= 150) {
        const timeDiff = (trace[j].timestamp - trace[i].timestamp) / 1000;
        if (timeDiff <= 15 && Math.abs(cumulativeChange) > Math.abs(bestHeadingChange)) {
          bestTurnStart = i;
          bestTurnEnd = j;
          bestHeadingChange = cumulativeChange;
        }
      }
    }
  }

  if (bestTurnStart === -1) return null;

  const turnDuration = (trace[bestTurnEnd].timestamp - trace[bestTurnStart].timestamp) / 1000;

  // Check if vehicle stopped before the turn
  let minSpeedBefore = Infinity;
  const lookbackStart = Math.max(0, bestTurnStart - 5);
  for (let i = lookbackStart; i <= bestTurnStart; i++) {
    if (trace[i].speedMph < minSpeedBefore) {
      minSpeedBefore = trace[i].speedMph;
    }
  }

  const stoppedBeforeTurn = minSpeedBefore <= 2.0; // 2 mph threshold for "stopped"
  const isLegal = stoppedBeforeTurn && bestHeadingChange >= 60 && bestHeadingChange <= 150;

  let explanation: string;
  if (isLegal) {
    explanation = `GPS heading data shows the vehicle executed a right turn (${bestHeadingChange.toFixed(0)}° clockwise heading change ` +
      `over ${turnDuration.toFixed(1)} seconds). The vehicle came to a stop (${minSpeedBefore.toFixed(1)} mph) before initiating the turn. ` +
      `Under Illinois law (625 ILCS 5/11-306(c)), right turns on red are permitted after a complete stop unless posted otherwise. ` +
      `This data is consistent with a lawful right-turn-on-red maneuver.`;
  } else if (bestHeadingChange >= 60) {
    explanation = `GPS heading data shows a right turn (${bestHeadingChange.toFixed(0)}° clockwise heading change). ` +
      `The minimum speed before the turn was ${minSpeedBefore.toFixed(1)} mph. ` +
      `While a right turn was detected, ${stoppedBeforeTurn ? 'the vehicle did stop before turning.' : 'no complete stop was detected before the turn.'}`;
  } else {
    explanation = 'No significant right turn was detected in the GPS heading data.';
  }

  return {
    rightTurnDetected: bestHeadingChange >= 60,
    headingChangeDeg: parseFloat(bestHeadingChange.toFixed(1)),
    turnDurationSec: parseFloat(turnDuration.toFixed(1)),
    turnStartIdx: bestTurnStart,
    turnEndIdx: bestTurnEnd,
    stoppedBeforeTurn,
    minSpeedBeforeTurnMph: parseFloat(minSpeedBefore.toFixed(1)),
    explanation,
    isLegalRightOnRed: isLegal,
  };
}

// ─── Intersection Geometry ───────────────────────────────────────────────────

/**
 * Haversine distance between two GPS coordinates (meters).
 */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function analyzeIntersectionGeometry(
  trace: TracePoint[],
  cameraLat: number,
  cameraLon: number,
): IntersectionGeometry | null {
  if (trace.length < 2) return null;

  // Calculate distance from each trace point to camera
  const distances = trace.map(t => haversineDistance(t.latitude, t.longitude, cameraLat, cameraLon));

  // Find closest point to camera (proxy for stop bar area)
  let minDist = Infinity;
  for (const d of distances) {
    if (d < minDist) minDist = d;
  }

  // Approach distance = distance from first trace point to camera
  const approachDistance = distances[0];

  // Approach time = time from first trace point to last
  const approachTime = (trace[trace.length - 1].timestamp - trace[0].timestamp) / 1000;

  // Average approach speed
  const avgSpeed = trace.reduce((sum, t) => sum + t.speedMph, 0) / trace.length;

  const summary = `Vehicle was tracked from ${approachDistance.toFixed(0)} meters before the camera location. ` +
    `The closest recorded position to the camera was ${minDist.toFixed(0)} meters. ` +
    `Average approach speed was ${avgSpeed.toFixed(1)} mph over ${approachTime.toFixed(0)} seconds of recorded data.`;

  return {
    approachDistanceMeters: parseFloat(approachDistance.toFixed(1)),
    approachTimeSec: parseFloat(approachTime.toFixed(1)),
    averageApproachSpeedMph: parseFloat(avgSpeed.toFixed(1)),
    closestPointToCamera: parseFloat(minDist.toFixed(1)),
    summary,
  };
}

// ─── Weather at Violation Time ───────────────────────────────────────────────

// ─── Violation Spike Detection ───────────────────────────────────────────────

/**
 * Check if the camera had an abnormally high number of violations on the
 * violation date — possible evidence of a malfunction.
 *
 * Uses Chicago Open Data Portal: Red Light Camera Violations dataset.
 * API: https://data.cityofchicago.org/resource/spqx-js37.json
 */
export async function analyzeViolationSpike(
  cameraAddress: string,
  violationDatetime: string,
): Promise<ViolationSpikeAnalysis | null> {
  try {
    const violationDate = new Date(violationDatetime);
    const dateStr = violationDate.toISOString().split('T')[0];

    // Build a 30-day window around the violation (15 before, 15 after)
    const windowStart = new Date(violationDate);
    windowStart.setDate(windowStart.getDate() - 15);
    const windowEnd = new Date(violationDate);
    windowEnd.setDate(windowEnd.getDate() + 15);
    const startStr = windowStart.toISOString().split('T')[0];
    const endStr = windowEnd.toISOString().split('T')[0];

    // Normalize address for matching (the dataset uses uppercase, e.g. "ASHLAND AND FULLERTON")
    const normalizedAddr = cameraAddress.toUpperCase().replace(/\./g, '').trim();

    // Query the open data API for this camera's violations in the window
    const url = `https://data.cityofchicago.org/resource/spqx-js37.json?` +
      `$where=violation_date >= '${startStr}' AND violation_date <= '${endStr}' ` +
      `AND upper(address) like '%25${encodeURIComponent(normalizedAddr.split(' ')[0])}%25'` +
      `&$limit=100&$order=violation_date`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error(`Open data API error: ${response.status}`);
      return null;
    }

    const rows: any[] = await response.json();
    if (!rows || rows.length === 0) return null;

    // Find the violation date count and compute average
    let violationDayCount = 0;
    let totalCount = 0;
    let dayCount = 0;

    for (const row of rows) {
      const rowDate = (row.violation_date || '').substring(0, 10);
      const count = parseInt(row.violations) || 0;
      totalCount += count;
      dayCount++;
      if (rowDate === dateStr) {
        violationDayCount += count;
      }
    }

    if (dayCount === 0 || violationDayCount === 0) return null;

    const avgDaily = totalCount / dayCount;
    const spikeRatio = violationDayCount / avgDaily;
    const isSpike = spikeRatio >= 3.0 && violationDayCount >= 10;

    let explanation: string;
    if (isSpike) {
      explanation = `The camera at ${cameraAddress} recorded ${violationDayCount} violations on the date of ` +
        `this ticket — ${spikeRatio.toFixed(1)}x the 30-day average of ${avgDaily.toFixed(1)} violations/day. ` +
        `This abnormal spike may indicate a camera malfunction, signal timing change, or other ` +
        `equipment issue that warrants investigation. Per Chicago Municipal Code, camera equipment ` +
        `must be properly calibrated and maintained.`;
    } else {
      explanation = `The camera at ${cameraAddress} recorded ${violationDayCount} violations on this date ` +
        `(30-day average: ${avgDaily.toFixed(1)}/day, ratio: ${spikeRatio.toFixed(1)}x). ` +
        `No anomalous spike detected.`;
    }

    return {
      violationsOnDate: violationDayCount,
      averageDailyViolations: Math.round(avgDaily * 10) / 10,
      spikeRatio: Math.round(spikeRatio * 10) / 10,
      isSpike,
      explanation,
    };
  } catch (err) {
    console.error('Violation spike analysis failed:', err);
    return null;
  }
}

// ─── Dilemma Zone Analysis ──────────────────────────────────────────────────

/**
 * Determine if the driver was in the "dilemma zone" — the area where
 * a driver can neither stop safely nor clear the intersection before
 * the light turns red.
 *
 * Physics:
 * - Stopping distance = v² / (2 * a), where a = comfortable deceleration
 * - Comfortable deceleration = 10 ft/s² (ITE standard)
 * - Clearing distance = intersection width + vehicle length ≈ 60-80 ft
 * - Clearing time = clearing_distance / v
 * - Dilemma zone exists when stopping_distance > distance_to_stop_bar
 *   AND clearing_time > remaining_yellow
 */
export function analyzeDilemmaZone(
  approachSpeedMph: number,
  distanceToStopBarMeters: number,
  yellowDurationSec: number,
  intersectionWidthFt: number = 70, // typical Chicago intersection
): DilemmaZoneAnalysis {
  const MPH_TO_FPS = 1.467; // mph to feet/second
  const COMFORTABLE_DECEL = 10; // ft/s² (ITE standard)
  const VEHICLE_LENGTH_FT = 17; // average vehicle length

  const v_fps = approachSpeedMph * MPH_TO_FPS;
  const distToStopFt = distanceToStopBarMeters * 3.281; // meters to feet

  // Stopping distance (physics: d = v²/(2a))
  const stoppingDistanceFt = (v_fps * v_fps) / (2 * COMFORTABLE_DECEL);

  // Distance to clear intersection = distance to stop bar + intersection width + vehicle length
  const distanceToClearFt = distToStopFt + intersectionWidthFt + VEHICLE_LENGTH_FT;

  // Time to clear intersection at current speed
  const timeToClearSec = distanceToClearFt / v_fps;

  // Can stop? Stopping distance must be <= distance to stop bar
  const canStop = stoppingDistanceFt <= distToStopFt;

  // Can clear? Time to clear must be <= yellow duration
  const canClear = timeToClearSec <= yellowDurationSec;

  // Dilemma zone = can't stop AND can't clear
  const inDilemmaZone = !canStop && !canClear;

  let explanation: string;
  if (inDilemmaZone) {
    explanation = `At ${approachSpeedMph.toFixed(0)} mph, the vehicle required ${stoppingDistanceFt.toFixed(0)} ft ` +
      `to stop safely (at comfortable deceleration of ${COMFORTABLE_DECEL} ft/s²), but was only ` +
      `${distToStopFt.toFixed(0)} ft from the stop bar. Simultaneously, the vehicle needed ` +
      `${timeToClearSec.toFixed(1)} seconds to clear the intersection, but the yellow signal ` +
      `duration was only ${yellowDurationSec.toFixed(1)} seconds. This places the driver in the ` +
      `"dilemma zone" — the area recognized by the ITE and FHWA where neither stopping nor ` +
      `proceeding is safe. This is a known traffic engineering problem, not driver error.`;
  } else if (!canStop) {
    explanation = `At ${approachSpeedMph.toFixed(0)} mph, the stopping distance (${stoppingDistanceFt.toFixed(0)} ft) ` +
      `exceeded the distance to the stop bar (${distToStopFt.toFixed(0)} ft). The driver could not ` +
      `have stopped safely and chose to proceed through the intersection.`;
  } else {
    explanation = `At ${approachSpeedMph.toFixed(0)} mph, the vehicle could have stopped within ` +
      `${stoppingDistanceFt.toFixed(0)} ft (${distToStopFt.toFixed(0)} ft available). ` +
      `Dilemma zone defense does not apply.`;
  }

  return {
    inDilemmaZone,
    stoppingDistanceFt: Math.round(stoppingDistanceFt),
    distanceToStopBarFt: Math.round(distToStopFt),
    distanceToClearFt: Math.round(distanceToClearFt),
    canStop,
    canClear,
    explanation,
  };
}

// ─── Late Notice Detection ──────────────────────────────────────────────────

/**
 * Check if the violation notice was mailed beyond the statutory deadline.
 * Under 625 ILCS 5/11-208.6, the notice must be mailed no later than
 * 90 days after the violation date.
 */
export function analyzeLateNotice(
  violationDateStr: string,
  noticeDateStr: string,
): LateNoticeAnalysis {
  const violationDate = new Date(violationDateStr);
  const noticeDate = new Date(noticeDateStr);

  const diffMs = noticeDate.getTime() - violationDate.getTime();
  const daysBetween = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const exceeds90 = daysBetween > 90;

  let explanation: string;
  if (exceeds90) {
    explanation = `The violation notice was issued ${daysBetween} days after the alleged violation — ` +
      `exceeding the 90-day statutory deadline under 625 ILCS 5/11-208.6. ` +
      `Illinois law requires that the written notice be mailed to the registered owner ` +
      `no later than 90 days after the violation. A notice issued ${daysBetween} days later ` +
      `may be subject to dismissal on procedural grounds.`;
  } else if (daysBetween > 60) {
    explanation = `The notice was issued ${daysBetween} days after the violation (within the 90-day ` +
      `statutory limit but approaching the deadline). This extended delay may be relevant ` +
      `context for the adjudicator.`;
  } else {
    explanation = `The notice was issued ${daysBetween} days after the violation, within normal ` +
      `processing timelines.`;
  }

  return { daysBetween, exceeds90Days: exceeds90, explanation };
}

// ─── Factual Inconsistency Check ────────────────────────────────────────────

/**
 * Compare information on the violation notice against the user's actual
 * vehicle/plate data. Inconsistencies are an official Chicago defense
 * under Municipal Code 9-100-060.
 */
export function analyzeFactualInconsistency(
  ticketPlate: string | null,
  ticketState: string | null,
  userPlate: string,
  userState: string,
): FactualInconsistencyAnalysis {
  const normTicketPlate = (ticketPlate || '').replace(/[\s-]/g, '').toUpperCase();
  const normUserPlate = userPlate.replace(/[\s-]/g, '').toUpperCase();
  const normTicketState = (ticketState || '').toUpperCase().trim();
  const normUserState = userState.toUpperCase().trim();

  if (normTicketPlate && normTicketPlate !== normUserPlate) {
    return {
      hasInconsistency: true,
      inconsistencyType: 'plate_mismatch',
      explanation: `The license plate on the violation notice (${ticketPlate}) does not match ` +
        `the vehicle owner's actual plate (${userPlate}). Under Chicago Municipal Code 9-100-060, ` +
        `"the facts alleged in the violation notice are inconsistent or do not support a finding ` +
        `that the code was violated" is an official defense. A plate mismatch means the ticket ` +
        `may have been issued to the wrong vehicle.`,
    };
  }

  if (normTicketState && normTicketState !== normUserState) {
    return {
      hasInconsistency: true,
      inconsistencyType: 'state_mismatch',
      explanation: `The plate state on the violation notice (${ticketState}) does not match ` +
        `the vehicle's actual registration state (${userState}). This factual inconsistency ` +
        `is a recognized defense under Chicago Municipal Code 9-100-060.`,
    };
  }

  return {
    hasInconsistency: false,
    inconsistencyType: null,
    explanation: 'No factual inconsistencies detected between ticket and vehicle registration.',
  };
}

// ─── Combined Defense Analysis ───────────────────────────────────────────────

export interface AnalysisInput {
  trace: TracePoint[];
  cameraLatitude: number;
  cameraLongitude: number;
  postedSpeedMph: number;
  approachSpeedMph: number | null;
  minSpeedMph: number | null;
  fullStopDetected: boolean;
  fullStopDurationSec: number | null;
  speedDeltaMph: number | null;
  violationDatetime: string | null; // ISO timestamp
  deviceTimestamp: string; // ISO timestamp
  /** Camera address for violation spike lookup (e.g. "2359 N ASHLAND AVE") */
  cameraAddress?: string;
  /** Date the violation notice was issued/mailed (ISO date string), for late-notice defense */
  noticeDate?: string | null;
  /** License plate on the ticket, for factual inconsistency check */
  ticketPlate?: string | null;
  /** State on the ticket */
  ticketState?: string | null;
  /** User's actual license plate */
  userPlate?: string | null;
  /** User's actual plate state */
  userState?: string | null;
}

/**
 * Run all defense analyses and produce a combined report.
 * This is the main entry point for the defense analysis pipeline.
 */
export async function analyzeRedLightDefense(
  input: AnalysisInput,
): Promise<RedLightDefenseAnalysis> {
  const {
    trace, cameraLatitude, cameraLongitude, postedSpeedMph,
    approachSpeedMph, minSpeedMph, fullStopDetected,
    fullStopDurationSec, speedDeltaMph,
    violationDatetime, deviceTimestamp,
    cameraAddress, noticeDate,
    ticketPlate, ticketState, userPlate, userState,
  } = input;

  // 1. Yellow light timing
  const yellowLight = analyzeYellowLightTiming(postedSpeedMph, approachSpeedMph);

  // 2. Right-turn detection
  const rightTurn = analyzeRightTurn(trace);

  // 3. Intersection geometry
  const geometry = analyzeIntersectionGeometry(trace, cameraLatitude, cameraLongitude);

  // 4. Weather (async — uses shared Open-Meteo service)
  let weather: WeatherAtViolation | null = null;
  const weatherTime = violationDatetime || deviceTimestamp;
  if (weatherTime) {
    try {
      weather = await getHourlyWeatherAtTime(cameraLatitude, cameraLongitude, weatherTime);
    } catch (err) {
      console.error('Weather analysis failed:', err);
    }
  }

  // 5. Violation spike detection (async — queries Chicago Open Data Portal)
  let violationSpike: ViolationSpikeAnalysis | null = null;
  if (cameraAddress && weatherTime) {
    try {
      violationSpike = await analyzeViolationSpike(cameraAddress, weatherTime);
    } catch (err) {
      console.error('Violation spike analysis failed:', err);
    }
  }

  // 6. Dilemma zone analysis (requires approach speed and geometry)
  let dilemmaZone: DilemmaZoneAnalysis | null = null;
  if (approachSpeedMph && approachSpeedMph > 5 && geometry) {
    const chicagoYellow = chicagoYellowDuration(postedSpeedMph);
    dilemmaZone = analyzeDilemmaZone(
      approachSpeedMph,
      geometry.closestPointToCamera, // meters to stop bar
      chicagoYellow,
    );
  }

  // 7. Late notice analysis
  let lateNotice: LateNoticeAnalysis | null = null;
  const violationDateStr = violationDatetime || deviceTimestamp;
  if (violationDateStr && noticeDate) {
    lateNotice = analyzeLateNotice(violationDateStr, noticeDate);
  }

  // 8. Factual inconsistency check
  let factualInconsistency: FactualInconsistencyAnalysis | null = null;
  if (userPlate && userState && (ticketPlate || ticketState)) {
    factualInconsistency = analyzeFactualInconsistency(
      ticketPlate || null, ticketState || null,
      userPlate, userState,
    );
  }

  // Build ordered defense arguments
  const defenseArguments: DefenseArgument[] = [];

  // Factual inconsistency (if found, this is the strongest possible defense)
  if (factualInconsistency?.hasInconsistency) {
    defenseArguments.push({
      type: 'factual_inconsistency',
      strength: 'strong',
      title: 'Factual Inconsistency on Violation Notice',
      summary: `${factualInconsistency.inconsistencyType === 'plate_mismatch' ? 'License plate' : 'Plate state'} on ticket does not match vehicle registration.`,
      details: factualInconsistency.explanation,
    });
  }

  // Late notice (procedural — can be case-dispositive)
  if (lateNotice?.exceeds90Days) {
    defenseArguments.push({
      type: 'late_notice',
      strength: 'strong',
      title: 'Notice Mailed After 90-Day Statutory Deadline',
      summary: `Notice issued ${lateNotice.daysBetween} days after violation (90-day limit under 625 ILCS 5/11-208.6).`,
      details: lateNotice.explanation,
    });
  } else if (lateNotice && lateNotice.daysBetween > 60) {
    defenseArguments.push({
      type: 'late_notice',
      strength: 'supporting',
      title: 'Near-Deadline Notice Issuance',
      summary: `Notice issued ${lateNotice.daysBetween} days after violation (approaching 90-day statutory deadline).`,
      details: lateNotice.explanation,
    });
  }

  // Full stop (from existing receipt data, not re-analyzed here)
  if (fullStopDetected) {
    defenseArguments.push({
      type: 'full_stop',
      strength: 'strong',
      title: 'Complete Stop Detected',
      summary: `Vehicle came to a complete stop${fullStopDurationSec ? ` for ${fullStopDurationSec.toFixed(1)} seconds` : ''}.`,
      details: `GPS and accelerometer data confirm the vehicle came to a complete stop at this intersection` +
        `${fullStopDurationSec ? `, sustained for ${fullStopDurationSec.toFixed(1)} seconds` : ''}. ` +
        `This is consistent with lawful driving behavior at a red light.`,
    });
  }

  // Right turn on red
  if (rightTurn?.isLegalRightOnRed) {
    defenseArguments.push({
      type: 'right_turn',
      strength: 'strong',
      title: 'Legal Right-Turn-on-Red Detected',
      summary: `GPS heading data shows a ${rightTurn.headingChangeDeg.toFixed(0)}° right turn after stopping.`,
      details: rightTurn.explanation,
    });
  } else if (rightTurn?.rightTurnDetected && rightTurn.stoppedBeforeTurn) {
    defenseArguments.push({
      type: 'right_turn',
      strength: 'moderate',
      title: 'Right Turn Detected (Stopped Before Turn)',
      summary: `Right turn of ${rightTurn.headingChangeDeg.toFixed(0)}° detected after stop.`,
      details: rightTurn.explanation,
    });
  }

  // Dilemma zone
  if (dilemmaZone?.inDilemmaZone) {
    defenseArguments.push({
      type: 'dilemma_zone',
      strength: 'strong',
      title: 'Driver Was in Dilemma Zone',
      summary: `At ${approachSpeedMph?.toFixed(0)} mph: couldn't stop (${dilemmaZone.stoppingDistanceFt} ft needed, ${dilemmaZone.distanceToStopBarFt} ft available) AND couldn't clear intersection.`,
      details: dilemmaZone.explanation,
    });
  } else if (dilemmaZone && !dilemmaZone.canStop) {
    defenseArguments.push({
      type: 'dilemma_zone',
      strength: 'moderate',
      title: 'Stopping Distance Exceeded Available Distance',
      summary: `Stopping required ${dilemmaZone.stoppingDistanceFt} ft but only ${dilemmaZone.distanceToStopBarFt} ft was available.`,
      details: dilemmaZone.explanation,
    });
  }

  // Yellow light timing shortfall
  if (yellowLight.isShorterThanStandard && yellowLight.shortfallSec >= 0.3) {
    defenseArguments.push({
      type: 'yellow_timing',
      strength: yellowLight.shortfallSec >= 0.5 ? 'strong' : 'moderate',
      title: 'Yellow Light Below National Standard',
      summary: `Chicago yellow is ${yellowLight.chicagoActualSec}s vs ITE standard ${yellowLight.iteRecommendedSec}s (${yellowLight.shortfallSec.toFixed(1)}s short).`,
      details: yellowLight.explanation,
    });
  } else if (yellowLight.isShorterThanStandard) {
    defenseArguments.push({
      type: 'yellow_timing',
      strength: 'supporting',
      title: 'Yellow Light Marginally Below Standard',
      summary: `Chicago yellow is ${yellowLight.shortfallSec.toFixed(2)}s shorter than ITE standard.`,
      details: yellowLight.explanation,
    });
  }

  // Violation spike / camera malfunction
  if (violationSpike?.isSpike) {
    defenseArguments.push({
      type: 'violation_spike',
      strength: 'moderate',
      title: 'Abnormal Violation Spike at Camera',
      summary: `${violationSpike.violationsOnDate} violations on this date — ${violationSpike.spikeRatio}x the 30-day average of ${violationSpike.averageDailyViolations}/day.`,
      details: violationSpike.explanation,
    });
  }

  // Significant deceleration (even without full stop)
  if (!fullStopDetected && speedDeltaMph && speedDeltaMph >= 5) {
    defenseArguments.push({
      type: 'deceleration',
      strength: speedDeltaMph >= 10 ? 'moderate' : 'supporting',
      title: 'Significant Deceleration Recorded',
      summary: `Vehicle slowed by ${speedDeltaMph.toFixed(1)} mph (from ${approachSpeedMph?.toFixed(1) || '?'} to ${minSpeedMph?.toFixed(1) || '?'} mph).`,
      details: `The GPS speed trace shows the driver actively decelerated from ${approachSpeedMph?.toFixed(1) || 'approach speed'} mph ` +
        `to ${minSpeedMph?.toFixed(1) || 'minimum recorded'} mph — a ${speedDeltaMph.toFixed(1)} mph reduction. ` +
        `This demonstrates the driver was attempting to stop and was driving with caution.`,
    });
  }

  // Weather/visibility
  if (weather?.hasAdverseConditions && weather.defenseArguments.length > 0) {
    defenseArguments.push({
      type: 'weather',
      strength: weather.impairedVisibility || weather.roadCondition ? 'moderate' : 'supporting',
      title: 'Adverse Weather Conditions',
      summary: weather.description,
      details: weather.defenseArguments.join(' '),
    });
  }

  // Geometry (always supporting, provides context)
  if (geometry && geometry.approachDistanceMeters > 0) {
    defenseArguments.push({
      type: 'geometry',
      strength: 'supporting',
      title: 'Intersection Approach Analysis',
      summary: `Approach tracked from ${geometry.approachDistanceMeters.toFixed(0)}m, closest point ${geometry.closestPointToCamera.toFixed(0)}m from camera.`,
      details: geometry.summary,
    });
  }

  // Calculate overall defense score
  const strongArgs = defenseArguments.filter(a => a.strength === 'strong').length;
  const moderateArgs = defenseArguments.filter(a => a.strength === 'moderate').length;
  const supportingArgs = defenseArguments.filter(a => a.strength === 'supporting').length;

  const overallScore = Math.min(100,
    strongArgs * 30 + moderateArgs * 15 + supportingArgs * 5
  );

  return {
    yellowLight,
    rightTurn,
    geometry,
    weather,
    violationSpike,
    dilemmaZone,
    lateNotice,
    factualInconsistency,
    overallDefenseScore: overallScore,
    defenseArguments,
  };
}
