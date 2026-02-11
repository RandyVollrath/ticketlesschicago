import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthService from './AuthService';
import AppEvents from './AppEvents';
import { StorageKeys } from '../constants';
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

function buildReceipt(params: {
  cameraAddress: string;
  cameraLatitude: number;
  cameraLongitude: number;
  heading: number;
  trace: RedLightTracePoint[];
  deviceTimestamp?: number;
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

  async findBestMatchForTicket(ticketTime: number): Promise<RedLightReceipt | null> {
    try {
      const stored = await AsyncStorage.getItem(RECEIPTS_KEY);
      const receipts: RedLightReceipt[] = stored ? JSON.parse(stored) : [];
      if (receipts.length === 0) return null;
      const sorted = receipts
        .map((r) => ({ r, dt: Math.abs(r.deviceTimestamp - ticketTime) }))
        .sort((a, b) => a.dt - b.dt);
      return sorted[0]?.r ?? null;
    } catch (error) {
      log.error('failed to match ticket to red-light receipt', error);
      return null;
    }
  }

  buildTimelineSummary(receipt: RedLightReceipt): string {
    const approach = receipt.approachSpeedMph != null ? `${Math.round(receipt.approachSpeedMph)} mph` : 'unknown speed';
    const decel = receipt.speedDeltaMph != null ? `${Math.round(receipt.speedDeltaMph)} mph` : 'unknown';
    if (receipt.fullStopDetected && receipt.fullStopDurationSec != null) {
      return `Approached at ${approach}, decelerated by ${decel}, stopped for ${receipt.fullStopDurationSec.toFixed(1)}s, then proceeded.`;
    }
    return `Approached at ${approach}, decelerated by ${decel}, no full stop detected in trace.`;
  }
}

export default new RedLightReceiptServiceClass();
