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
 *
 * All analysis is deterministic and based on publicly available standards.
 */

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

export interface WeatherAtViolation {
  /** Whether conditions were adverse */
  hasAdverseConditions: boolean;
  /** Temperature (F) */
  temperatureF: number | null;
  /** Visibility (miles) */
  visibilityMiles: number | null;
  /** Whether visibility was impaired (< 5 miles) */
  impairedVisibility: boolean;
  /** Precipitation type if any */
  precipitationType: string | null;
  /** Precipitation amount (inches) */
  precipitationInches: number | null;
  /** Road condition description */
  roadCondition: string | null;
  /** Wind speed (mph) */
  windSpeedMph: number | null;
  /** Sun position (day/night/dawn/dusk) */
  sunPosition: string | null;
  /** Human-readable weather description */
  description: string;
  /** Defense arguments based on weather */
  defenseArguments: string[];
  /** Data source */
  source: string;
}

export interface RedLightDefenseAnalysis {
  /** Yellow light timing analysis */
  yellowLight: YellowLightAnalysis | null;
  /** Right-turn-on-red detection */
  rightTurn: RightTurnAnalysis | null;
  /** Intersection geometry */
  geometry: IntersectionGeometry | null;
  /** Weather at violation time */
  weather: WeatherAtViolation | null;
  /** Combined defense strength (0-100) */
  overallDefenseScore: number;
  /** Ordered list of defense arguments, strongest first */
  defenseArguments: DefenseArgument[];
}

export interface DefenseArgument {
  type: 'yellow_timing' | 'right_turn' | 'full_stop' | 'weather' | 'geometry' | 'deceleration';
  strength: 'strong' | 'moderate' | 'supporting';
  title: string;
  summary: string;
  details: string;
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

/**
 * Fetch weather conditions at the time and place of a violation.
 * Uses Visual Crossing Timeline API (free tier: 1,000 records/day).
 * Falls back to Open-Meteo if Visual Crossing is unavailable.
 */
export async function getWeatherAtViolationTime(
  latitude: number,
  longitude: number,
  violationDatetime: string, // ISO timestamp
): Promise<WeatherAtViolation | null> {
  const apiKey = process.env.VISUAL_CROSSING_API_KEY;

  // Parse the violation time
  const violationDate = new Date(violationDatetime);
  const dateStr = violationDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const hour = violationDate.getUTCHours();

  // Determine sun position based on hour (Chicago timezone approximation)
  // Chicago is UTC-6 (CST) or UTC-5 (CDT)
  const chicagoHour = (hour - 6 + 24) % 24; // rough CST approximation
  let sunPosition: string;
  if (chicagoHour >= 6 && chicagoHour < 8) sunPosition = 'dawn';
  else if (chicagoHour >= 8 && chicagoHour < 17) sunPosition = 'day';
  else if (chicagoHour >= 17 && chicagoHour < 19) sunPosition = 'dusk';
  else sunPosition = 'night';

  if (apiKey) {
    try {
      return await fetchVisualCrossingWeather(latitude, longitude, dateStr, hour, sunPosition, apiKey);
    } catch (err) {
      console.error('Visual Crossing weather fetch failed, trying Open-Meteo fallback:', err);
    }
  }

  // Fallback to Open-Meteo (no visibility data but still useful)
  try {
    return await fetchOpenMeteoWeather(latitude, longitude, dateStr, hour, sunPosition);
  } catch (err) {
    console.error('Open-Meteo weather fetch also failed:', err);
    return null;
  }
}

async function fetchVisualCrossingWeather(
  lat: number, lon: number,
  dateStr: string, hour: number,
  sunPosition: string,
  apiKey: string,
): Promise<WeatherAtViolation> {
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/` +
    `${lat},${lon}/${dateStr}/${dateStr}?` +
    `key=${apiKey}&include=hours&unitGroup=us&contentType=json`;

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Visual Crossing API error: ${response.status}`);
  }

  const data = await response.json();
  const day = data.days?.[0];
  if (!day) throw new Error('No weather data returned');

  // Find the hour closest to the violation time
  const hourData = day.hours?.find((h: any) => {
    const hHour = parseInt(h.datetime?.split(':')?.[0] || '-1');
    return hHour === hour;
  }) || day.hours?.[Math.min(hour, (day.hours?.length || 1) - 1)];

  const temp = hourData?.temp ?? day.temp ?? null;
  const visibility = hourData?.visibility ?? day.visibility ?? null;
  const precipType = hourData?.preciptype?.[0] ?? null;
  const precipAmount = hourData?.precip ?? day.precip ?? null;
  const windSpeed = hourData?.windspeed ?? day.windspeed ?? null;
  const conditions = hourData?.conditions ?? day.conditions ?? 'Unknown';
  const humidity = hourData?.humidity ?? null;

  const impairedVisibility = visibility !== null && visibility < 5;

  // Determine road condition
  let roadCondition: string | null = null;
  if (temp !== null && temp < 32 && precipAmount && precipAmount > 0) {
    roadCondition = 'Potentially icy/snowy road surface';
  } else if (precipType === 'rain' && precipAmount && precipAmount > 0.1) {
    roadCondition = 'Wet road surface';
  } else if (precipType === 'snow' || precipType === 'freezingrain') {
    roadCondition = precipType === 'snow' ? 'Snow-covered road surface' : 'Ice-covered road surface';
  }

  // Build defense arguments
  const defenseArguments: string[] = [];
  if (impairedVisibility) {
    defenseArguments.push(
      `Visibility was only ${visibility?.toFixed(1)} miles at the time of the violation, ` +
      `significantly below the 10+ miles of clear-day visibility. Reduced visibility affects ` +
      `a driver's ability to judge traffic signal timing and intersection geometry.`
    );
  }
  if (sunPosition === 'night' || sunPosition === 'dawn' || sunPosition === 'dusk') {
    defenseArguments.push(
      `The violation occurred during ${sunPosition} hours when visibility is naturally reduced ` +
      `and glare can obscure traffic signals.`
    );
  }
  if (roadCondition) {
    defenseArguments.push(
      `Road conditions were adverse (${roadCondition}), which affects stopping distance ` +
      `and may require drivers to proceed through intersections rather than attempting ` +
      `an unsafe stop on a slippery surface.`
    );
  }
  if (temp !== null && temp < 32) {
    defenseArguments.push(
      `The temperature was ${Math.round(temp)}°F (below freezing), which increases stopping ` +
      `distance due to potential ice on the road surface.`
    );
  }
  if (precipType) {
    defenseArguments.push(
      `Active precipitation (${precipType}) was occurring, which affects visibility, ` +
      `road grip, and stopping distance.`
    );
  }
  if (windSpeed && windSpeed > 20) {
    defenseArguments.push(
      `Wind speeds of ${Math.round(windSpeed)} mph were recorded, which can affect vehicle ` +
      `handling and contribute to camera false triggers.`
    );
  }

  const hasAdverse = impairedVisibility || !!roadCondition || !!precipType ||
    (temp !== null && temp < 32) || sunPosition === 'night' ||
    (windSpeed !== null && windSpeed > 20);

  return {
    hasAdverseConditions: hasAdverse,
    temperatureF: temp,
    visibilityMiles: visibility,
    impairedVisibility,
    precipitationType: precipType,
    precipitationInches: precipAmount,
    roadCondition,
    windSpeedMph: windSpeed,
    sunPosition,
    description: `${conditions}${temp !== null ? `, ${Math.round(temp)}°F` : ''}` +
      `${visibility !== null ? `, ${visibility.toFixed(1)} mi visibility` : ''}` +
      `${precipType ? `, ${precipType}` : ''}`,
    defenseArguments,
    source: 'Visual Crossing Weather API',
  };
}

async function fetchOpenMeteoWeather(
  lat: number, lon: number,
  dateStr: string, hour: number,
  sunPosition: string,
): Promise<WeatherAtViolation> {
  const url = `https://archive-api.open-meteo.com/v1/archive?` +
    `latitude=${lat}&longitude=${lon}` +
    `&start_date=${dateStr}&end_date=${dateStr}` +
    `&hourly=temperature_2m,precipitation,snowfall,rain,weather_code,wind_speed_10m` +
    `&timezone=America/Chicago` +
    `&temperature_unit=fahrenheit` +
    `&precipitation_unit=inch`;

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.hourly?.time) throw new Error('No hourly data');

  // Find the hour index
  const hourIdx = Math.min(hour, data.hourly.time.length - 1);

  const temp = data.hourly.temperature_2m?.[hourIdx] ?? null;
  const precip = data.hourly.precipitation?.[hourIdx] ?? null;
  const snowfall = data.hourly.snowfall?.[hourIdx] ?? null;
  const rain = data.hourly.rain?.[hourIdx] ?? null;
  const weatherCode = data.hourly.weather_code?.[hourIdx] ?? null;
  const windSpeed = data.hourly.wind_speed_10m?.[hourIdx] ?? null;

  // Weather code descriptions (WMO)
  const codeDescriptions: Record<number, string> = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    77: 'Snow grains', 80: 'Slight rain showers', 81: 'Moderate rain showers',
    82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
  };

  const conditions = weatherCode !== null ? (codeDescriptions[weatherCode] || `Code ${weatherCode}`) : 'Unknown';

  // Determine precipitation type
  let precipType: string | null = null;
  if (snowfall && snowfall > 0) precipType = 'snow';
  else if (weatherCode && weatherCode >= 66 && weatherCode <= 67) precipType = 'freezingrain';
  else if (rain && rain > 0) precipType = 'rain';

  let roadCondition: string | null = null;
  if (temp !== null && temp < 32 && precip && precip > 0) {
    roadCondition = 'Potentially icy/snowy road surface';
  } else if (precipType === 'rain' && precip && precip > 0.1) {
    roadCondition = 'Wet road surface';
  } else if (precipType === 'snow') {
    roadCondition = 'Snow-covered road surface';
  } else if (precipType === 'freezingrain') {
    roadCondition = 'Ice-covered road surface';
  }

  const defenseArguments: string[] = [];
  if (sunPosition === 'night' || sunPosition === 'dawn' || sunPosition === 'dusk') {
    defenseArguments.push(
      `The violation occurred during ${sunPosition} hours when visibility is reduced.`
    );
  }
  if (roadCondition) {
    defenseArguments.push(
      `Road conditions were adverse (${roadCondition}), affecting stopping distance.`
    );
  }
  if (temp !== null && temp < 32) {
    defenseArguments.push(
      `Below-freezing temperature (${Math.round(temp)}°F) increases stopping distance.`
    );
  }
  if (precipType) {
    defenseArguments.push(
      `Active precipitation (${precipType}) affected visibility and road conditions.`
    );
  }
  if (windSpeed && windSpeed > 20) {
    defenseArguments.push(
      `High winds (${Math.round(windSpeed)} mph) may affect vehicle handling.`
    );
  }

  const hasAdverse = !!roadCondition || !!precipType ||
    (temp !== null && temp < 32) || sunPosition === 'night' ||
    (windSpeed !== null && windSpeed > 20);

  return {
    hasAdverseConditions: hasAdverse,
    temperatureF: temp,
    visibilityMiles: null, // Open-Meteo doesn't have visibility
    impairedVisibility: false,
    precipitationType: precipType,
    precipitationInches: precip,
    roadCondition,
    windSpeedMph: windSpeed,
    sunPosition,
    description: `${conditions}${temp !== null ? `, ${Math.round(temp)}°F` : ''}` +
      `${precipType ? `, ${precipType}` : ''}`,
    defenseArguments,
    source: 'Open-Meteo Historical Weather API',
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
  } = input;

  // 1. Yellow light timing
  const yellowLight = analyzeYellowLightTiming(postedSpeedMph, approachSpeedMph);

  // 2. Right-turn detection
  const rightTurn = analyzeRightTurn(trace);

  // 3. Intersection geometry
  const geometry = analyzeIntersectionGeometry(trace, cameraLatitude, cameraLongitude);

  // 4. Weather (async)
  let weather: WeatherAtViolation | null = null;
  const weatherTime = violationDatetime || deviceTimestamp;
  if (weatherTime) {
    try {
      weather = await getWeatherAtViolationTime(cameraLatitude, cameraLongitude, weatherTime);
    } catch (err) {
      console.error('Weather analysis failed:', err);
    }
  }

  // Build ordered defense arguments
  const defenseArguments: DefenseArgument[] = [];

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
    overallDefenseScore: overallScore,
    defenseArguments,
  };
}
