/**
 * Parking Save Retry Queue
 *
 * When a parking history server save fails (auth expired, network error, etc.),
 * the payload is queued here for retry. The queue is persisted in AsyncStorage
 * and processed:
 *   - On every subsequent parking detection
 *   - When the app returns to foreground
 *   - On pull-to-refresh in the History tab
 *
 * This prevents silent data loss when background auth tokens expire on iOS.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '../constants';
import AuthService from './AuthService';
import { ApiClient } from '../utils/ApiClient';
import Logger from '../utils/Logger';

const log = Logger.createLogger('ParkingSaveQueue');

const MAX_RETRIES = 50; // Way more retries — history is gold, keep trying
const MAX_QUEUE_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year — don't lose history data even if user has extended connectivity issues

export interface QueuedParkingSave {
  id: string;
  queuedAt: number;      // When first queued
  retryCount: number;
  lastRetryAt: number;
  payload: {
    latitude: number;
    longitude: number;
    address: string;
    fcm_token: string;
    [key: string]: any;   // All the restriction flags
  };
}

async function getQueue(): Promise<QueuedParkingSave[]> {
  try {
    const raw = await AsyncStorage.getItem(StorageKeys.PARKING_SAVE_RETRY_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedParkingSave[]): Promise<void> {
  await AsyncStorage.setItem(StorageKeys.PARKING_SAVE_RETRY_QUEUE, JSON.stringify(queue));
}

/**
 * Add a failed save to the retry queue.
 */
export async function enqueue(payload: QueuedParkingSave['payload']): Promise<void> {
  try {
    const queue = await getQueue();
    const item: QueuedParkingSave = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: Date.now(),
      retryCount: 0,
      lastRetryAt: 0,
      payload,
    };
    queue.push(item);
    await saveQueue(queue);
    log.info(`Enqueued failed parking save (queue size: ${queue.length}), addr="${payload.address}"`);
  } catch (err) {
    log.error('Failed to enqueue parking save:', err);
  }
}

/**
 * Process the retry queue. Call this when auth is likely fresh
 * (after a successful parking check, on foreground, etc.).
 *
 * Returns the number of items successfully saved.
 */
export async function processQueue(): Promise<number> {
  if (!AuthService.isAuthenticated()) {
    return 0;
  }

  const queue = await getQueue();
  if (queue.length === 0) return 0;

  log.info(`Processing parking save queue (${queue.length} items)`);

  const remaining: QueuedParkingSave[] = [];
  let succeeded = 0;
  let consecutiveFailures = 0;

  for (const item of queue) {
    // Drop items older than 30 days or over max retries
    if (Date.now() - item.queuedAt > MAX_QUEUE_AGE_MS) {
      log.warn(`Dropping queued save from ${new Date(item.queuedAt).toISOString()} — too old`);
      continue;
    }
    if (item.retryCount >= MAX_RETRIES) {
      log.warn(`Dropping queued save after ${item.retryCount} retries, addr="${item.payload.address}"`);
      continue;
    }

    // If we've had 3 consecutive failures, stop — likely auth/network issue.
    // But keep remaining items in queue (don't increment their retry count).
    if (consecutiveFailures >= 3) {
      remaining.push(item);
      continue;
    }

    // Update FCM token to current (may have changed since original save)
    // Don't fail if we can't get one — use the original
    try {
      const PushNotificationService = require('./PushNotificationService').default;
      const freshToken = await PushNotificationService.getToken();
      if (freshToken) {
        item.payload.fcm_token = freshToken;
      }
    } catch { /* keep original token */ }

    try {
      const response = await ApiClient.authPost<any>(
        '/api/mobile/save-parked-location',
        item.payload,
        { retries: 1, timeout: 15000, showErrorAlert: false }
      );

      if (response.success) {
        succeeded++;
        consecutiveFailures = 0;
        log.info(`Retry succeeded for queued save, addr="${item.payload.address}" (attempt ${item.retryCount + 1})`);
        // Don't add to remaining — it's done
      } else {
        item.retryCount++;
        item.lastRetryAt = Date.now();
        remaining.push(item);
        consecutiveFailures++;
        log.warn(`Retry failed for queued save (attempt ${item.retryCount}), addr="${item.payload.address}"`);
      }
    } catch (err) {
      item.retryCount++;
      item.lastRetryAt = Date.now();
      remaining.push(item);
      consecutiveFailures++;
      log.error(`Retry exception for queued save (attempt ${item.retryCount}):`, err);
    }
  }

  await saveQueue(remaining);

  if (succeeded > 0) {
    log.info(`Queue processing complete: ${succeeded} saved, ${remaining.length} remaining`);
  }

  return succeeded;
}

/**
 * Get current queue size (for health monitoring).
 */
export async function getQueueSize(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

const ParkingSaveQueue = { enqueue, processQueue, getQueueSize };
export default ParkingSaveQueue;
