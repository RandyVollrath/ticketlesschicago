import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraLocation } from '../data/chicago-cameras';
import AuthService from './AuthService';
import { StorageKeys } from '../constants';
import Logger from '../utils/Logger';

const log = Logger.createLogger('CameraPassHistoryService');

export interface CameraPassHistoryItem {
  id: string;
  timestamp: number;
  alertTimestamp: number | null;
  cameraType: 'speed' | 'redlight';
  cameraAddress: string;
  cameraLatitude: number;
  cameraLongitude: number;
  userLatitude: number;
  userLongitude: number;
  userSpeedMps: number | null;
  userSpeedMph: number | null;
  alertSpeedMps: number | null;
  alertSpeedMph: number | null;
  expectedSpeedMph: number | null;
  speedDeltaMph: number | null;
}

const HISTORY_KEY = StorageKeys.CAMERA_PASS_HISTORY;
const MAX_CAMERA_PASS_ITEMS = 200;

const toMph = (mps: number): number => mps * 2.2369362920544;

const buildHistoryItem = (params: {
  camera: CameraLocation;
  userLatitude: number;
  userLongitude: number;
  timestamp?: number;
  speedMps?: number;
  alertSpeedMps?: number;
  alertTimestamp?: number;
}): CameraPassHistoryItem => {
  const speedMps = params.speedMps ?? -1;
  const speedMph = speedMps >= 0 ? toMph(speedMps) : null;
  const alertSpeedMps = params.alertSpeedMps ?? -1;
  const alertSpeedMph = alertSpeedMps >= 0 ? toMph(alertSpeedMps) : null;
  const expectedSpeedMph = params.camera.speedLimitMph ?? null;
  const speedDeltaMph =
    speedMph != null && expectedSpeedMph != null
      ? speedMph - expectedSpeedMph
      : null;

  const eventTime = params.timestamp ?? Date.now();

  return {
    id: `${eventTime}-${params.camera.type}-${params.camera.latitude.toFixed(6)}-${params.camera.longitude.toFixed(6)}`,
    timestamp: eventTime,
    alertTimestamp: params.alertTimestamp ?? null,
    cameraType: params.camera.type,
    cameraAddress: params.camera.address,
    cameraLatitude: params.camera.latitude,
    cameraLongitude: params.camera.longitude,
    userLatitude: params.userLatitude,
    userLongitude: params.userLongitude,
    userSpeedMps: speedMps >= 0 ? speedMps : null,
    userSpeedMph: speedMph != null ? Number(speedMph.toFixed(1)) : null,
    alertSpeedMps: alertSpeedMps >= 0 ? alertSpeedMps : null,
    alertSpeedMph: alertSpeedMph != null ? Number(alertSpeedMph.toFixed(1)) : null,
    expectedSpeedMph,
    speedDeltaMph: speedDeltaMph != null ? Number(speedDeltaMph.toFixed(1)) : null,
  };
};

const syncAddToServer = async (item: CameraPassHistoryItem): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated()) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;

    const supabase = AuthService.getSupabaseClient();
    const { error } = await supabase.from('camera_pass_history').insert({
      user_id: userId,
      passed_at: new Date(item.timestamp).toISOString(),
      camera_type: item.cameraType,
      camera_address: item.cameraAddress,
      camera_latitude: item.cameraLatitude,
      camera_longitude: item.cameraLongitude,
      user_latitude: item.userLatitude,
      user_longitude: item.userLongitude,
      user_speed_mps: item.userSpeedMps,
      user_speed_mph: item.userSpeedMph,
      alert_speed_mps: item.alertSpeedMps,
      alert_speed_mph: item.alertSpeedMph,
      alerted_at: item.alertTimestamp != null ? new Date(item.alertTimestamp).toISOString() : null,
      expected_speed_mph: item.expectedSpeedMph,
      speed_delta_mph: item.speedDeltaMph,
    });

    if (error) {
      log.debug('Sync add failed (non-fatal)', error.message);
    }
  } catch (e) {
    log.debug('Sync add exception (non-fatal)', e);
  }
};

const restoreFromServer = async (): Promise<CameraPassHistoryItem[]> => {
  try {
    if (!AuthService.isAuthenticated()) return [];
    const supabase = AuthService.getSupabaseClient();
    const { data, error } = await supabase
      .from('camera_pass_history')
      .select('*')
      .order('passed_at', { ascending: false })
      .limit(MAX_CAMERA_PASS_ITEMS);

    if (error || !data || data.length === 0) return [];

    const items: CameraPassHistoryItem[] = data.map((row: any) => ({
      id: String(row.id ?? `${new Date(row.passed_at).getTime()}-${row.camera_type ?? 'camera'}`),
      timestamp: new Date(row.passed_at).getTime(),
      alertTimestamp: row.alerted_at ? new Date(row.alerted_at).getTime() : null,
      cameraType: row.camera_type,
      cameraAddress: row.camera_address,
      cameraLatitude: Number(row.camera_latitude),
      cameraLongitude: Number(row.camera_longitude),
      userLatitude: Number(row.user_latitude),
      userLongitude: Number(row.user_longitude),
      userSpeedMps: row.user_speed_mps != null ? Number(row.user_speed_mps) : null,
      userSpeedMph: row.user_speed_mph != null ? Number(row.user_speed_mph) : null,
      alertSpeedMps: row.alert_speed_mps != null ? Number(row.alert_speed_mps) : null,
      alertSpeedMph: row.alert_speed_mph != null ? Number(row.alert_speed_mph) : null,
      expectedSpeedMph: row.expected_speed_mph != null ? Number(row.expected_speed_mph) : null,
      speedDeltaMph: row.speed_delta_mph != null ? Number(row.speed_delta_mph) : null,
    }));

    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    return items;
  } catch (e) {
    log.debug('Restore from server failed (non-fatal)', e);
    return [];
  }
};

class CameraPassHistoryServiceClass {
  async getHistory(): Promise<CameraPassHistoryItem[]> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const local: CameraPassHistoryItem[] = stored ? JSON.parse(stored) : [];

      if (local.length === 0 && AuthService.isAuthenticated()) {
        return await restoreFromServer();
      }

      return local;
    } catch (error) {
      log.error('Error getting camera pass history', error);
      return [];
    }
  }

  async addPassEvent(params: {
    camera: CameraLocation;
    userLatitude: number;
    userLongitude: number;
    timestamp?: number;
    speedMps?: number;
    alertSpeedMps?: number;
    alertTimestamp?: number;
  }): Promise<void> {
    try {
      const item = buildHistoryItem(params);
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: CameraPassHistoryItem[] = stored ? JSON.parse(stored) : [];
      const updated = [item, ...history].slice(0, MAX_CAMERA_PASS_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      syncAddToServer(item);
    } catch (error) {
      log.error('Error adding camera pass history item', error);
    }
  }

  async clearHistory(): Promise<void> {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      log.error('Error clearing camera pass history', error);
    }
  }
}

export default new CameraPassHistoryServiceClass();
