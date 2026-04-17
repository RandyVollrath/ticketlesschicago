/**
 * DebugReportService
 *
 * Packages up everything useful for remote debugging and POSTs it to
 * /api/mobile/submit-debug-report. This is the emergency channel when
 * automatic log uploads fail silently — user taps a button, server gets
 * the full picture.
 *
 * Bundled per report:
 *   - Native log files (parking_detection.log + .prev, parking_decisions.ndjson + .prev)
 *   - AsyncStorage parking history
 *   - ParkingSaveQueue contents
 *   - App state snapshot (version, auth, FCM token, permissions)
 *   - Recent JS logs from Logger in-memory buffer (if available)
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ApiClient from '../utils/ApiClient';
import AuthService from './AuthService';
import BackgroundLocationService from './BackgroundLocationService';
import PushNotificationService from './PushNotificationService';
import Logger from '../utils/Logger';
import Config from '../config/config';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('DebugReportService');

export interface DebugReportResult {
  success: boolean;
  id?: string;
  error?: string;
}

async function readAsyncStorageKey(key: string): Promise<any> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // not JSON, return as string
    }
  } catch {
    return null;
  }
}

/**
 * Collect all diagnostic data into a single payload.
 *
 * mode='manual' (default): user tapped Send Debug Report — send everything we
 *   have, up to 1.5MB per log file and full history/queue.
 * mode='auto': fired automatically after a parking or camera event — trim logs
 *   and arrays to keep per-report storage cost bounded when running across
 *   every user, every parking event.
 */
async function collectPayload(mode: 'manual' | 'auto' = 'manual'): Promise<Record<string, any>> {
  const logBytesPerFile = mode === 'auto' ? 250_000 : 1_500_000;
  const maxHistoryItems = mode === 'auto' ? 20 : Number.POSITIVE_INFINITY;
  const maxQueueItems = mode === 'auto' ? 20 : Number.POSITIVE_INFINITY;
  const maxJsLogEntries = mode === 'auto' ? 100 : 500;

  const [
    debugLogs,
    history,
    queue,
    lastParkedCoords,
    lastParkingCheck,
    fcmToken,
    logInfo,
    pipelineHealth,
  ] = await Promise.all([
    BackgroundLocationService.getDebugLogBundle(logBytesPerFile),
    readAsyncStorageKey(StorageKeys.PARKING_HISTORY),
    readAsyncStorageKey(StorageKeys.PARKING_SAVE_RETRY_QUEUE),
    readAsyncStorageKey(StorageKeys.LAST_PARKED_COORDS),
    readAsyncStorageKey(StorageKeys.LAST_PARKING_LOCATION),
    PushNotificationService.getToken().catch(() => null),
    BackgroundLocationService.getDecisionLogInfo().catch(() => null),
    readAsyncStorageKey('parking_pipeline_health_v1'),
  ]);

  // Get in-memory JS log buffer if the Logger supports it
  let recentLogs: any[] = [];
  try {
    const anyLogger: any = Logger as any;
    if (typeof anyLogger.getRecentLogs === 'function') {
      recentLogs = anyLogger.getRecentLogs();
    } else if (Array.isArray(anyLogger.buffer)) {
      recentLogs = anyLogger.buffer.slice(-maxJsLogEntries);
    }
    if (recentLogs.length > maxJsLogEntries) {
      recentLogs = recentLogs.slice(-maxJsLogEntries);
    }
  } catch {
    // Logger doesn't expose a buffer — that's OK
  }

  const trimmedHistory = Array.isArray(history) && maxHistoryItems !== Number.POSITIVE_INFINITY
    ? history.slice(-maxHistoryItems)
    : (history || []);
  const trimmedQueue = Array.isArray(queue) && maxQueueItems !== Number.POSITIVE_INFINITY
    ? queue.slice(-maxQueueItems)
    : (queue || []);

  const user = AuthService.getUser();

  return {
    collected_at: new Date().toISOString(),
    app_state: {
      platform: Platform.OS,
      platform_version: Platform.Version,
      app_version: Config.APP_VERSION || 'unknown',
      api_base_url: Config.API_BASE_URL,
      is_authenticated: AuthService.isAuthenticated(),
      user_id: user?.id || null,
      user_email: user?.email || null,
      fcm_token_present: !!fcmToken,
      fcm_token_preview: fcmToken ? `${fcmToken.substring(0, 12)}...` : null,
    },
    native_logs: debugLogs,           // {filename: contents}
    native_log_info: logInfo,
    local_parking_history: {
      count: Array.isArray(history) ? history.length : 0,
      items: trimmedHistory,
      truncated: Array.isArray(history) && history.length > (trimmedHistory as any[]).length,
    },
    parking_save_retry_queue: {
      count: Array.isArray(queue) ? queue.length : 0,
      items: trimmedQueue,
      truncated: Array.isArray(queue) && queue.length > (trimmedQueue as any[]).length,
    },
    report_mode: mode,
    last_parked_coords: lastParkedCoords,
    last_parking_check: lastParkingCheck,
    pipeline_health: pipelineHealth,
    recent_js_logs: recentLogs,
  };
}

/**
 * Package everything and submit to the server. User-facing — returns
 * a success/error result the UI can display.
 */
export async function submitDebugReport(
  note?: string,
  options?: { mode?: 'manual' | 'auto' },
): Promise<DebugReportResult> {
  const mode = options?.mode || 'manual';
  try {
    if (!AuthService.isAuthenticated()) {
      return { success: false, error: 'Not signed in' };
    }

    // Refresh token first — server save path has shown us that background
    // auth can silently expire. Do this before we spend time collecting data.
    await AuthService.refreshToken().catch(() => {});

    log.info(`Collecting debug report payload (mode=${mode})...`);
    const payload = await collectPayload(mode);
    const payloadSize = JSON.stringify(payload).length;
    log.info(`Debug report collected: ${payloadSize} bytes`);

    const response = await ApiClient.authPost<{ success: boolean; id: string }>(
      '/api/mobile/submit-debug-report',
      {
        app_version: Config.APP_VERSION,
        platform: Platform.OS,
        note: note || undefined,
        payload,
      },
      {
        retries: 1,
        timeout: 60000,
        showErrorAlert: false,
      }
    );

    if (response.success && response.data?.success) {
      log.info(`Debug report submitted successfully: id=${response.data.id}`);
      return { success: true, id: response.data.id };
    }

    const errorMsg = response.error?.message || 'Unknown error';
    log.warn('Debug report submission failed:', errorMsg);
    return { success: false, error: errorMsg };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error('Debug report exception:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Fire-and-forget auto debug report after interesting events
 * (parking confirmed, camera alert, misdetection corrected, etc).
 *
 * Gated by Config.DEBUG_AUTO_REPORT_EMAILS — only enrolled users generate
 * auto-uploads. Per-reason throttle prevents spam from rapid BT reconnect
 * flaps or repeated camera passes.
 *
 * Safe to call from any hot path — async work is detached and errors are
 * swallowed to the log (never thrown back at the caller).
 */
const AUTO_REPORT_MIN_INTERVAL_MS = 60 * 1000;
const lastAutoReportAt = new Map<string, number>();

export function triggerAutoDebugReport(reason: string, meta?: Record<string, any>): void {
  try {
    // Empty allowlist = enabled for all authenticated users (we want data
    // from everyone to improve parking detection). Non-empty = gated to listed emails.
    const enrolled: string[] = (Config as any).DEBUG_AUTO_REPORT_EMAILS || [];

    const user = AuthService.getUser();
    const email = user?.email?.toLowerCase();
    if (!email) return;
    if (enrolled.length > 0 && !enrolled.some((e) => e.toLowerCase() === email)) return;

    const now = Date.now();
    const last = lastAutoReportAt.get(reason) || 0;
    if (now - last < AUTO_REPORT_MIN_INTERVAL_MS) {
      log.debug(`auto-report throttled: reason=${reason} (${Math.round((now - last) / 1000)}s since last)`);
      return;
    }
    lastAutoReportAt.set(reason, now);

    const note = meta
      ? `auto:${reason} ${JSON.stringify(meta).slice(0, 400)}`
      : `auto:${reason}`;

    // Fire-and-forget — don't block the caller, don't surface errors.
    // Use 'auto' mode so payload size is capped (we're running this across
    // every user, every parking event).
    submitDebugReport(note, { mode: 'auto' })
      .then((r) => {
        if (r.success) {
          log.info(`auto-report submitted: reason=${reason} id=${r.id}`);
        } else {
          log.warn(`auto-report failed: reason=${reason} error=${r.error}`);
        }
      })
      .catch((e) => {
        log.warn(`auto-report exception: reason=${reason}`, e);
      });
  } catch (e) {
    log.warn('triggerAutoDebugReport synchronous error:', e);
  }
}

export default { submitDebugReport, triggerAutoDebugReport };
