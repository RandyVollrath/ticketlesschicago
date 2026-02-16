import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiClient } from '../utils/ApiClient';
import Logger from '../utils/Logger';

const log = Logger.createLogger('GroundTruthService');

const STORAGE_KEY = 'GROUND_TRUTH_QUEUE_V1';
const MAX_QUEUE_ITEMS = 300;

export type GroundTruthEventType =
  | 'parking_false_positive'
  | 'parking_confirmed'
  | 'camera_alert_fallback'
  | 'camera_alert_medium_confidence'
  | 'camera_alert_suppressed_low_confidence';

export interface GroundTruthEvent {
  type: GroundTruthEventType;
  timestamp: number;
  driveSessionId?: string | null;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, unknown>;
}

class GroundTruthServiceClass {
  private flushing = false;

  async recordEvent(event: GroundTruthEvent): Promise<void> {
    try {
      const queued = await this.getQueue();
      const next = [
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ...event,
        },
        ...queued,
      ].slice(0, MAX_QUEUE_ITEMS);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      void this.flushQueue();
    } catch (error) {
      log.warn('Failed to queue ground-truth event', error);
    }
  }

  async flushQueue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const queued = await this.getQueue();
      if (queued.length === 0) return;

      const response = await ApiClient.authPost<{ accepted: number }>(
        '/api/mobile/ground-truth',
        { events: queued },
        { retries: 1, retryDelay: 500, timeout: 10000, showErrorAlert: false }
      );

      if (!response.success) {
        return;
      }

      await AsyncStorage.removeItem(STORAGE_KEY);
      log.info(`Ground-truth events flushed: ${queued.length}`);
    } catch (error) {
      log.warn('Ground-truth flush failed', error);
    } finally {
      this.flushing = false;
    }
  }

  private async getQueue(): Promise<any[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }
}

const GroundTruthService = new GroundTruthServiceClass();
export default GroundTruthService;
