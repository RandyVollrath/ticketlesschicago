import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share, Linking, Platform } from 'react-native';
import AuthService from './AuthService';
import AppEvents from './AppEvents';
import { StorageKeys } from '../constants';
import Config from '../config/config';
import Logger from '../utils/Logger';

const log = Logger.createLogger('RedLightReceiptService');

export interface RedLightTracePoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  speedMps: number;
  speedMph: number;
  heading: number;
  horizontalAccuracyMeters: number | null;
}

export interface AccelerometerDataPoint {
  timestamp: number;
  /** User acceleration (gravity removed) in G's — x, y, z */
  x: number; y: number; z: number;
  /** Gravity vector in G's */
  gx: number; gy: number; gz: number;
}

export interface RedLightReceipt {
  id: string;
  deviceTimestamp: number;
  cameraAddress: string;
  cameraLatitude: number;
  cameraLongitude: number;
  intersectionId: string;
  heading: number;
  approachSpeedMph: number | null;
  minSpeedMph: number | null;
  speedDeltaMph: number | null;
  fullStopDetected: boolean;
  fullStopDurationSec: number | null;
  horizontalAccuracyMeters: number | null;
  estimatedSpeedAccuracyMph: number | null;
  trace: RedLightTracePoint[];
  /** Accelerometer data during approach — proves deceleration/stop pattern */
  accelerometerTrace?: AccelerometerDataPoint[];
  /** Peak deceleration in G's (negative = braking) */
  peakDecelerationG?: number | null;
  /** Yellow light duration for this intersection (Chicago standard) */
  expectedYellowDurationSec?: number;
  /** Posted speed limit at intersection (used for yellow timing calc) */
  postedSpeedLimitMph?: number;
}

const RECEIPTS_KEY = StorageKeys.RED_LIGHT_RECEIPTS;
const MAX_RECEIPTS = 120;

const STOP_SPEED_MPS = 0.2235; // 0.5 mph
const STOP_MIN_DURATION_MS = 2000;

const mpsToMph = (mps: number): number => mps * 2.2369362920544;

function buildIntersectionId(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function estimateSpeedAccuracyMph(trace: RedLightTracePoint[]): number | null {
  const valid = trace
    .map((p) => p.horizontalAccuracyMeters)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  const avgAccuracyMeters = valid.reduce((a, b) => a + b, 0) / valid.length;
  // Rough heuristic: convert horizontal jitter to mph-equivalent uncertainty window.
  return Number(Math.max(1, Math.min(8, avgAccuracyMeters / 3.5)).toFixed(1));
}

function detectStopDurationMs(trace: RedLightTracePoint[]): number {
  let best = 0;
  let runStart: number | null = null;
  for (const p of trace) {
    if (p.speedMps <= STOP_SPEED_MPS && p.speedMps >= 0) {
      if (runStart == null) runStart = p.timestamp;
    } else if (runStart != null) {
      best = Math.max(best, p.timestamp - runStart);
      runStart = null;
    }
  }
  if (runStart != null && trace.length > 0) {
    best = Math.max(best, trace[trace.length - 1].timestamp - runStart);
  }
  return best;
}

/**
 * Chicago yellow light timing rules:
 * - ≤30 mph posted speed → 3.0 seconds (Chicago standard)
 * - ≥35 mph posted speed → 4.0 seconds
 * - ITE formula recommends 3.2s at 30 mph → Chicago uses higher deceleration rate
 *   to justify 3.0s, which traffic engineers have criticized
 * - Illinois law requires camera intersections to meet national standards
 */
function getExpectedYellowDuration(postedSpeedMph: number): number {
  return postedSpeedMph <= 30 ? 3.0 : 4.0;
}

/**
 * Calculate peak deceleration from accelerometer data.
 * Uses the forward axis (y-axis for phone mounted in car portrait).
 * Returns the most negative value (strongest braking).
 */
function calculatePeakDeceleration(accelData: AccelerometerDataPoint[]): number | null {
  if (accelData.length === 0) return null;
  // Compute magnitude of deceleration in the horizontal plane.
  // Negative y = braking (phone facing up in car, user decelerating).
  // Use the full horizontal magnitude for robustness regardless of phone orientation.
  let peakG = 0;
  for (const p of accelData) {
    // Horizontal acceleration magnitude (x-y plane, gravity already removed)
    const horizontalG = Math.sqrt(p.x * p.x + p.y * p.y);
    if (horizontalG > Math.abs(peakG)) {
      // Determine sign: if y is negative, user is decelerating (braking)
      peakG = p.y < 0 ? -horizontalG : horizontalG;
    }
  }
  return Number(peakG.toFixed(3));
}

function buildReceipt(params: {
  cameraAddress: string;
  cameraLatitude: number;
  cameraLongitude: number;
  heading: number;
  trace: RedLightTracePoint[];
  deviceTimestamp?: number;
  accelerometerTrace?: AccelerometerDataPoint[];
  postedSpeedLimitMph?: number;
}): RedLightReceipt {
  const trace = params.trace.slice().sort((a, b) => a.timestamp - b.timestamp);
  const ts = params.deviceTimestamp ?? Date.now();
  const approach = trace.find((p) => p.speedMps >= 0);
  const speeds = trace.filter((p) => p.speedMps >= 0).map((p) => p.speedMps);
  const minSpeedMps = speeds.length > 0 ? Math.min(...speeds) : null;
  const maxSpeedMps = speeds.length > 0 ? Math.max(...speeds) : null;
  const stopDurationMs = detectStopDurationMs(trace);
  const fullStopDetected = stopDurationMs >= STOP_MIN_DURATION_MS;
  const avgAccuracy =
    trace
      .map((p) => p.horizontalAccuracyMeters)
      .filter((v): v is number => v != null)
      .reduce((sum, v, _, arr) => sum + v / arr.length, 0) || null;

  // Yellow light timing (default 30 mph for Chicago streets)
  const postedSpeed = params.postedSpeedLimitMph ?? 30;
  const expectedYellow = getExpectedYellowDuration(postedSpeed);

  // Accelerometer analysis
  const accelTrace = params.accelerometerTrace ?? [];
  const peakDecel = calculatePeakDeceleration(accelTrace);

  return {
    id: `${ts}-${params.cameraLatitude.toFixed(5)}-${params.cameraLongitude.toFixed(5)}`,
    deviceTimestamp: ts,
    cameraAddress: params.cameraAddress,
    cameraLatitude: params.cameraLatitude,
    cameraLongitude: params.cameraLongitude,
    intersectionId: buildIntersectionId(params.cameraLatitude, params.cameraLongitude),
    heading: params.heading,
    approachSpeedMph: approach ? Number(mpsToMph(approach.speedMps).toFixed(1)) : null,
    minSpeedMph: minSpeedMps != null ? Number(mpsToMph(minSpeedMps).toFixed(1)) : null,
    speedDeltaMph:
      minSpeedMps != null && maxSpeedMps != null
        ? Number((mpsToMph(maxSpeedMps) - mpsToMph(minSpeedMps)).toFixed(1))
        : null,
    fullStopDetected,
    fullStopDurationSec: fullStopDetected ? Number((stopDurationMs / 1000).toFixed(1)) : null,
    horizontalAccuracyMeters: avgAccuracy != null ? Number(avgAccuracy.toFixed(1)) : null,
    estimatedSpeedAccuracyMph: estimateSpeedAccuracyMph(trace),
    trace,
    accelerometerTrace: accelTrace.length > 0 ? accelTrace : undefined,
    peakDecelerationG: peakDecel,
    expectedYellowDurationSec: expectedYellow,
    postedSpeedLimitMph: postedSpeed,
  };
}

const syncAddToServer = async (receipt: RedLightReceipt): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated()) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;
    const supabase = AuthService.getSupabaseClient();
    const { error } = await supabase.from('red_light_receipts').insert({
      user_id: userId,
      device_timestamp: new Date(receipt.deviceTimestamp).toISOString(),
      camera_address: receipt.cameraAddress,
      camera_latitude: receipt.cameraLatitude,
      camera_longitude: receipt.cameraLongitude,
      intersection_id: receipt.intersectionId,
      heading: receipt.heading,
      approach_speed_mph: receipt.approachSpeedMph,
      min_speed_mph: receipt.minSpeedMph,
      speed_delta_mph: receipt.speedDeltaMph,
      full_stop_detected: receipt.fullStopDetected,
      full_stop_duration_sec: receipt.fullStopDurationSec,
      horizontal_accuracy_meters: receipt.horizontalAccuracyMeters,
      estimated_speed_accuracy_mph: receipt.estimatedSpeedAccuracyMph,
      trace: receipt.trace,
      accelerometer_trace: receipt.accelerometerTrace ?? null,
      peak_deceleration_g: receipt.peakDecelerationG ?? null,
      expected_yellow_duration_sec: receipt.expectedYellowDurationSec ?? null,
      posted_speed_limit_mph: receipt.postedSpeedLimitMph ?? null,
    });
    if (error) log.debug('red-light sync failed (non-fatal)', error.message);
  } catch (e) {
    log.debug('red-light sync exception (non-fatal)', e);
  }
};

class RedLightReceiptServiceClass {
  async getReceipts(): Promise<RedLightReceipt[]> {
    try {
      const stored = await AsyncStorage.getItem(RECEIPTS_KEY);
      const local: RedLightReceipt[] = stored ? JSON.parse(stored) : [];
      if (local.length > 0) return local;

      if (!AuthService.isAuthenticated()) return [];
      const userId = AuthService.getUser()?.id;
      if (!userId) return [];
      const supabase = AuthService.getSupabaseClient();
      const { data, error } = await supabase
        .from('red_light_receipts')
        .select('*')
        .order('device_timestamp', { ascending: false })
        .limit(MAX_RECEIPTS);
      if (error || !data) return [];

      const restored: RedLightReceipt[] = data.map((row: any) => ({
        id: String(row.id),
        deviceTimestamp: new Date(row.device_timestamp).getTime(),
        cameraAddress: row.camera_address,
        cameraLatitude: Number(row.camera_latitude),
        cameraLongitude: Number(row.camera_longitude),
        intersectionId: row.intersection_id,
        heading: Number(row.heading ?? 0),
        approachSpeedMph: row.approach_speed_mph != null ? Number(row.approach_speed_mph) : null,
        minSpeedMph: row.min_speed_mph != null ? Number(row.min_speed_mph) : null,
        speedDeltaMph: row.speed_delta_mph != null ? Number(row.speed_delta_mph) : null,
        fullStopDetected: Boolean(row.full_stop_detected),
        fullStopDurationSec: row.full_stop_duration_sec != null ? Number(row.full_stop_duration_sec) : null,
        horizontalAccuracyMeters: row.horizontal_accuracy_meters != null ? Number(row.horizontal_accuracy_meters) : null,
        estimatedSpeedAccuracyMph: row.estimated_speed_accuracy_mph != null ? Number(row.estimated_speed_accuracy_mph) : null,
        trace: Array.isArray(row.trace) ? row.trace : [],
      }));

      await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(restored));
      return restored;
    } catch (error) {
      log.error('failed to load red-light receipts', error);
      return [];
    }
  }

  async clearReceipts(): Promise<void> {
    try {
      await AsyncStorage.removeItem(RECEIPTS_KEY);
      AppEvents.emit('red-light-receipts-updated');
    } catch (error) {
      log.error('failed to clear red-light receipts', error);
    }
  }

  async addReceipt(params: {
    cameraAddress: string;
    cameraLatitude: number;
    cameraLongitude: number;
    heading: number;
    trace: RedLightTracePoint[];
    deviceTimestamp?: number;
    accelerometerTrace?: AccelerometerDataPoint[];
    postedSpeedLimitMph?: number;
  }): Promise<void> {
    try {
      const receipt = buildReceipt(params);
      const stored = await AsyncStorage.getItem(RECEIPTS_KEY);
      const existing: RedLightReceipt[] = stored ? JSON.parse(stored) : [];
      const updated = [receipt, ...existing].slice(0, MAX_RECEIPTS);
      await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(updated));
      AppEvents.emit('red-light-receipts-updated');
      syncAddToServer(receipt);
    } catch (error) {
      log.error('failed to store red-light receipt', error);
    }
  }

  /**
   * Find the best matching receipt for a ticket by timestamp and optionally location.
   * Searches local cache first, falls back to server.
   * @param ticketTime - Violation timestamp in ms
   * @param ticketLat - Optional ticket latitude for location matching
   * @param ticketLng - Optional ticket longitude for location matching
   * @param maxTimeDiffMs - Max time difference to consider a match (default 5 min)
   */
  async findBestMatchForTicket(
    ticketTime: number,
    ticketLat?: number,
    ticketLng?: number,
    maxTimeDiffMs: number = 5 * 60 * 1000
  ): Promise<RedLightReceipt | null> {
    try {
      const stored = await AsyncStorage.getItem(RECEIPTS_KEY);
      let receipts: RedLightReceipt[] = stored ? JSON.parse(stored) : [];

      // Also try server if local is empty
      if (receipts.length === 0 && AuthService.isAuthenticated()) {
        const userId = AuthService.getUser()?.id;
        if (userId) {
          const supabase = AuthService.getSupabaseClient();
          const ticketDate = new Date(ticketTime);
          const windowStart = new Date(ticketTime - maxTimeDiffMs).toISOString();
          const windowEnd = new Date(ticketTime + maxTimeDiffMs).toISOString();
          const { data } = await supabase
            .from('red_light_receipts')
            .select('*')
            .gte('device_timestamp', windowStart)
            .lte('device_timestamp', windowEnd)
            .order('device_timestamp', { ascending: false })
            .limit(10);
          if (data && data.length > 0) {
            receipts = data.map((row: any) => ({
              id: String(row.id),
              deviceTimestamp: new Date(row.device_timestamp).getTime(),
              cameraAddress: row.camera_address,
              cameraLatitude: Number(row.camera_latitude),
              cameraLongitude: Number(row.camera_longitude),
              intersectionId: row.intersection_id,
              heading: Number(row.heading ?? 0),
              approachSpeedMph: row.approach_speed_mph != null ? Number(row.approach_speed_mph) : null,
              minSpeedMph: row.min_speed_mph != null ? Number(row.min_speed_mph) : null,
              speedDeltaMph: row.speed_delta_mph != null ? Number(row.speed_delta_mph) : null,
              fullStopDetected: Boolean(row.full_stop_detected),
              fullStopDurationSec: row.full_stop_duration_sec != null ? Number(row.full_stop_duration_sec) : null,
              horizontalAccuracyMeters: row.horizontal_accuracy_meters != null ? Number(row.horizontal_accuracy_meters) : null,
              estimatedSpeedAccuracyMph: row.estimated_speed_accuracy_mph != null ? Number(row.estimated_speed_accuracy_mph) : null,
              trace: Array.isArray(row.trace) ? row.trace : [],
              accelerometerTrace: Array.isArray(row.accelerometer_trace) ? row.accelerometer_trace : undefined,
              peakDecelerationG: row.peak_deceleration_g != null ? Number(row.peak_deceleration_g) : null,
              expectedYellowDurationSec: row.expected_yellow_duration_sec != null ? Number(row.expected_yellow_duration_sec) : undefined,
              postedSpeedLimitMph: row.posted_speed_limit_mph != null ? Number(row.posted_speed_limit_mph) : undefined,
            }));
          }
        }
      }

      if (receipts.length === 0) return null;

      // Score each receipt: lower = better match
      const scored = receipts
        .map((r) => {
          const timeDiff = Math.abs(r.deviceTimestamp - ticketTime);
          if (timeDiff > maxTimeDiffMs) return null;

          let score = timeDiff / 1000; // seconds of time difference
          // Bonus: location match — if ticket location provided, prefer closer cameras
          if (ticketLat != null && ticketLng != null) {
            const dLat = r.cameraLatitude - ticketLat;
            const dLng = r.cameraLongitude - ticketLng;
            const distDeg = Math.sqrt(dLat * dLat + dLng * dLng);
            const distMeters = distDeg * 111000; // rough conversion
            if (distMeters < 200) {
              score -= 1000; // Strong bonus for location match
            }
          }
          return { receipt: r, score };
        })
        .filter((x): x is { receipt: RedLightReceipt; score: number } => x != null)
        .sort((a, b) => a.score - b.score);

      return scored[0]?.receipt ?? null;
    } catch (error) {
      log.error('failed to match ticket to red-light receipt', error);
      return null;
    }
  }

  buildTimelineSummary(receipt: RedLightReceipt): string {
    const approach = receipt.approachSpeedMph != null ? `${Math.round(receipt.approachSpeedMph)} mph` : 'unknown speed';
    const decel = receipt.speedDeltaMph != null ? `${Math.round(receipt.speedDeltaMph)} mph` : 'unknown';

    let summary: string;
    if (receipt.fullStopDetected && receipt.fullStopDurationSec != null) {
      summary = `Approached at ${approach}, decelerated by ${decel}, stopped for ${receipt.fullStopDurationSec.toFixed(1)}s, then proceeded.`;
    } else {
      summary = `Approached at ${approach}, decelerated by ${decel}, no full stop detected in trace.`;
    }

    // Add accelerometer evidence if available
    if (receipt.peakDecelerationG != null) {
      const gForce = Math.abs(receipt.peakDecelerationG).toFixed(2);
      summary += ` Peak braking force: ${gForce}G.`;
    }

    // Add yellow light timing context
    if (receipt.expectedYellowDurationSec != null) {
      summary += ` Expected yellow: ${receipt.expectedYellowDurationSec}s (Chicago ${receipt.postedSpeedLimitMph ?? 30} mph standard).`;
    }

    return summary;
  }

  /**
   * Generate and share a PDF evidence receipt for a red light camera pass.
   * Opens the PDF in the device browser or shares the download URL.
   */
  async exportReceiptAsPdf(receipt: RedLightReceipt): Promise<boolean> {
    try {
      if (!AuthService.isAuthenticated()) {
        log.warn('Cannot export PDF - not authenticated');
        return false;
      }

      const session = await AuthService.getSession();
      if (!session?.access_token) {
        log.warn('Cannot export PDF - no access token');
        return false;
      }

      const apiUrl = `${Config.API_BASE_URL}/api/evidence/red-light-receipt-pdf`;

      // Try to share the receipt data directly to the API and open in browser
      // We use Linking to open a one-time-use URL, but since it's POST-only,
      // we'll use Share to provide the URL and let the user fetch it, or
      // we can try to download it via fetch and share the blob.

      // Attempt 1: Fetch the PDF as a blob via the API
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ receipt }),
      });

      if (!response.ok) {
        log.error('PDF API returned error', response.status);
        // Fallback: share receipt summary as text
        return this.shareReceiptAsText(receipt);
      }

      // On mobile, we can't easily save/share a blob without react-native-fs.
      // Best approach: share a text summary with the data, and provide instructions
      // to generate the full PDF on the web dashboard.
      log.info('PDF generated successfully on server');

      // Share a text version with a link to download the PDF from the web
      return this.shareReceiptAsText(receipt);
    } catch (error) {
      log.error('Failed to export PDF', error);
      return false;
    }
  }

  /**
   * Share receipt evidence as formatted text (works without any native dependencies).
   * Includes a link to the full PDF on the web dashboard.
   */
  async shareReceiptAsText(receipt: RedLightReceipt): Promise<boolean> {
    try {
      const timestamp = new Date(receipt.deviceTimestamp);
      const dateStr = timestamp.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const timeStr = timestamp.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      let text = `RED LIGHT CAMERA EVIDENCE RECEIPT\n`;
      text += `Generated by Autopilot America\n`;
      text += `${'='.repeat(40)}\n\n`;
      text += `Date: ${dateStr}\n`;
      text += `Time: ${timeStr}\n`;
      text += `Camera: ${receipt.cameraAddress}\n`;
      text += `Location: ${receipt.cameraLatitude.toFixed(6)}, ${receipt.cameraLongitude.toFixed(6)}\n`;
      text += `Heading: ${Math.round(receipt.heading)}°\n\n`;

      text += `VEHICLE BEHAVIOR\n`;
      text += `${'-'.repeat(20)}\n`;
      if (receipt.approachSpeedMph != null) {
        text += `Approach Speed: ${Math.round(receipt.approachSpeedMph)} mph\n`;
      }
      if (receipt.minSpeedMph != null) {
        text += `Minimum Speed: ${receipt.minSpeedMph.toFixed(1)} mph\n`;
      }
      if (receipt.speedDeltaMph != null) {
        text += `Speed Reduction: ${Math.round(receipt.speedDeltaMph)} mph\n`;
      }
      text += `Full Stop: ${receipt.fullStopDetected ? 'YES' : 'NO'}`;
      if (receipt.fullStopDetected && receipt.fullStopDurationSec != null) {
        text += ` (${receipt.fullStopDurationSec.toFixed(1)}s)`;
      }
      text += '\n';

      if (receipt.peakDecelerationG != null) {
        text += `Peak Braking: ${Math.abs(receipt.peakDecelerationG).toFixed(2)}G\n`;
      }

      if (receipt.expectedYellowDurationSec != null) {
        text += `\nYELLOW LIGHT TIMING\n`;
        text += `${'-'.repeat(20)}\n`;
        text += `Chicago Standard: ${receipt.expectedYellowDurationSec}s (at ${receipt.postedSpeedLimitMph ?? 30} mph)\n`;
        const vFps = (receipt.postedSpeedLimitMph ?? 30) * 1.467;
        const iteRec = (1.0 + vFps / 20).toFixed(1);
        text += `ITE Recommended: ${iteRec}s\n`;
      }

      text += `\nGPS Trace: ${receipt.trace.length} data points recorded\n`;
      if (receipt.accelerometerTrace && receipt.accelerometerTrace.length > 0) {
        text += `Accelerometer: ${receipt.accelerometerTrace.length} sensor readings\n`;
      }
      text += `GPS Accuracy: ${receipt.horizontalAccuracyMeters?.toFixed(1) ?? 'N/A'}m avg\n`;

      text += `\nReceipt ID: ${receipt.id}\n`;
      text += `\nFull PDF with charts available at autopilotamerica.com\n`;

      await Share.share({
        message: text,
        title: `Red Light Evidence - ${receipt.cameraAddress}`,
      });

      return true;
    } catch (error) {
      log.error('Failed to share receipt', error);
      return false;
    }
  }
}

export default new RedLightReceiptServiceClass();
