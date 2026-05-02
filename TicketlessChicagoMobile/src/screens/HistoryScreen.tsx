import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { StatusBadge, RuleCard } from '../components';
import { ParkingRule, Coordinates } from '../services/LocationService';
import AuthService from '../services/AuthService';
import CameraPassHistoryService, { CameraPassHistoryItem } from '../services/CameraPassHistoryService';
import RedLightReceiptService, { RedLightReceipt } from '../services/RedLightReceiptService';
import AppEvents from '../services/AppEvents';
import AnalyticsService from '../services/AnalyticsService';
import Logger from '../utils/Logger';
import { isCoordinateAddress, formatCoordinateFallback, resolveAddress } from '../utils/ClientReverseGeocoder';
import { distanceMeters } from '../utils/geo';
import Config from '../config/config';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('HistoryScreen');

export interface ParkingHistoryItem {
  id: string;
  coords: Coordinates;
  address?: string;
  rules: ParkingRule[];
  timestamp: number;
  // Departure tracking (for ticket contesting)
  departure?: {
    confirmedAt: number;       // When departure was recorded
    distanceMeters: number;    // Distance from parking spot
    isConclusive: boolean;     // Far enough to prove departure
    latitude: number;
    longitude: number;
  };
  detectionMeta?: {
    detectionSource?: string;
    locationSource?: string;
    accuracy?: number;
    drivingDurationSec?: number;
    nativeTimestamp?: number;
    driveSessionId?: string | null;
    recordedAt: number;
  };
}

const HISTORY_KEY = StorageKeys.PARKING_HISTORY;
const MAX_HISTORY_ITEMS = 10000; // Effectively unlimited — server is the authoritative store

// ──────────────────────────────────────────────────────
// Supabase sync helpers (fire-and-forget, never blocks UI)
// ──────────────────────────────────────────────────────

/** Push a new history item directly to Supabase (belt-and-suspenders fallback). */
const syncAddToServer = async (item: ParkingHistoryItem): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated()) {
      log.warn('syncAddToServer: not authenticated, cannot sync to server');
      return;
    }
    const userId = AuthService.getUser()?.id;
    if (!userId) {
      log.warn('syncAddToServer: no user ID');
      return;
    }

    const supabase = AuthService.getSupabaseClient();
    const { error } = await supabase.from('parking_location_history').insert({
      user_id: userId,
      latitude: item.coords.latitude,
      longitude: item.coords.longitude,
      address: item.address || null,
      parked_at: new Date(item.timestamp).toISOString(),
      // Map rules to known columns
      on_winter_ban_street: item.rules.some(r => r.type === 'winter_ban'),
      winter_ban_street_name: item.rules.find(r => r.type === 'winter_ban')?.streetName || null,
      on_snow_route: item.rules.some(r => r.type === 'snow_route'),
      snow_route_name: item.rules.find(r => r.type === 'snow_route')?.streetName || null,
      street_cleaning_date: item.rules.find(r => r.type === 'street_cleaning')?.nextDate || null,
      street_cleaning_ward: item.rules.find(r => r.type === 'street_cleaning')?.ward || null,
      street_cleaning_section: item.rules.find(r => r.type === 'street_cleaning')?.section || null,
      permit_zone: item.rules.find(r => r.type === 'permit_zone')?.zone || null,
      permit_restriction_schedule: item.rules.find(r => r.type === 'permit_zone')?.schedule || null,
    });
    if (error) log.warn('syncAddToServer: Supabase insert failed', error.message);
    else log.info(`syncAddToServer: history synced to server for "${item.address}"`);
  } catch (e) {
    log.warn('syncAddToServer: exception', e);
  }
};

/**
 * Sync any field update (address backfill, etc.) to the server.
 * Matches the server row by user_id + parked_at timestamp.
 * Non-fatal on failure; bulk sync will eventually catch missed updates.
 */
const syncUpdateToServer = async (
  item: ParkingHistoryItem,
  updates: Partial<Pick<ParkingHistoryItem, 'address' | 'coords'>>
): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated()) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;

    const patch: Record<string, unknown> = {};
    if (updates.address) patch.address = updates.address;
    if (updates.coords) {
      patch.latitude = updates.coords.latitude;
      patch.longitude = updates.coords.longitude;
    }
    if (Object.keys(patch).length === 0) return; // nothing server-relevant

    const supabase = AuthService.getSupabaseClient();

    // Match by parked_at within a 10-minute window (in case of ms drift)
    const rangeStart = new Date(item.timestamp - 10 * 60 * 1000).toISOString();
    const rangeEnd = new Date(item.timestamp + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('parking_location_history')
      .update(patch)
      .eq('user_id', userId)
      .gte('parked_at', rangeStart)
      .lte('parked_at', rangeEnd);

    if (error) {
      log.warn('syncUpdateToServer: update failed', error.message);
    } else {
      log.info(`syncUpdateToServer: updated ${Object.keys(patch).join(',')} on server`);
    }
  } catch (e) {
    log.warn('syncUpdateToServer: exception', e);
  }
};

/** Push departure data update to Supabase. Fails silently. */
const syncDepartureToServer = async (item: ParkingHistoryItem): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated() || !item.departure) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;

    const supabase = AuthService.getSupabaseClient();
    const parkedAtIso = new Date(item.timestamp).toISOString();
    const departureIso = new Date(item.departure.confirmedAt).toISOString();

    // First attempt: exact parked_at match
    const { data: exactUpdatedRows, error } = await supabase
      .from('parking_location_history')
      .update({
        departure_latitude: item.departure.latitude,
        departure_longitude: item.departure.longitude,
        departure_confirmed_at: departureIso,
        departure_distance_meters: item.departure.distanceMeters,
        cleared_at: departureIso,
      })
      .eq('user_id', userId)
      .eq('parked_at', parkedAtIso)
      .select('id');

    if (!error && exactUpdatedRows && exactUpdatedRows.length > 0) return;

    // Fallback: timestamp drift tolerance. Find nearby parking rows and update best match.
    const { data: candidates, error: candidateError } = await supabase
      .from('parking_location_history')
      .select('id, parked_at')
      .eq('user_id', userId)
      .is('departure_confirmed_at', null)
      .order('parked_at', { ascending: false })
      .limit(20);

    if (candidateError || !candidates || candidates.length === 0) {
      if (error) log.debug('Sync departure failed (non-fatal)', error.message);
      return;
    }

    const targetMs = new Date(parkedAtIso).getTime();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const best = candidates
      .map((c: any) => ({ id: c.id, diff: Math.abs(new Date(c.parked_at).getTime() - targetMs) }))
      .sort((a: any, b: any) => a.diff - b.diff)[0];

    if (!best || best.diff > SIX_HOURS_MS) return;

    const { error: fallbackUpdateError } = await supabase
      .from('parking_location_history')
      .update({
        departure_latitude: item.departure.latitude,
        departure_longitude: item.departure.longitude,
        departure_confirmed_at: departureIso,
        departure_distance_meters: item.departure.distanceMeters,
        cleared_at: departureIso,
      })
      .eq('id', best.id)
      .eq('user_id', userId);

    if (fallbackUpdateError) {
      log.debug('Sync departure fallback failed (non-fatal)', fallbackUpdateError.message);
    } else {
      log.debug('Sync departure fallback succeeded', { matchedRecordId: best.id, diffMs: best.diff });
    }
  } catch (e) {
    log.debug('Sync departure exception (non-fatal)', e);
  }
};

/** Convert a Supabase parking_location_history row to a ParkingHistoryItem. */
const serverRowToHistoryItem = (row: any): ParkingHistoryItem => {
  const rules: ParkingRule[] = [];
  if (row.on_winter_ban_street) {
    rules.push({ type: 'winter_ban', severity: 'critical', streetName: row.winter_ban_street_name || '', description: 'Winter overnight parking ban' } as ParkingRule);
  }
  if (row.on_snow_route) {
    rules.push({ type: 'snow_route', severity: 'warning', streetName: row.snow_route_name || '', description: 'Snow route' } as ParkingRule);
  }
  if (row.street_cleaning_date) {
    rules.push({ type: 'street_cleaning', severity: 'warning', nextDate: row.street_cleaning_date, ward: row.street_cleaning_ward || '', section: row.street_cleaning_section || '', description: 'Street cleaning' } as ParkingRule);
  }
  if (row.permit_zone) {
    rules.push({ type: 'permit_zone', severity: 'info', zone: row.permit_zone, schedule: row.permit_restriction_schedule || '', description: `Permit zone ${row.permit_zone}` } as ParkingRule);
  }

  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  // Never display raw coordinates — use a friendly fallback
  let address: string | undefined = row.address || undefined;
  if (!address || isCoordinateAddress(address)) {
    address = formatCoordinateFallback(lat, lng);
  }

  const item: ParkingHistoryItem = {
    id: new Date(row.parked_at).getTime().toString(),
    coords: { latitude: lat, longitude: lng },
    address,
    rules,
    timestamp: new Date(row.parked_at).getTime(),
  };

  if (row.departure_confirmed_at) {
    item.departure = {
      confirmedAt: new Date(row.departure_confirmed_at).getTime(),
      distanceMeters: row.departure_distance_meters || 0,
      isConclusive: (row.departure_distance_meters || 0) > 50,
      latitude: row.departure_latitude || 0,
      longitude: row.departure_longitude || 0,
    };
  }
  return item;
};

/** Fetch history items from Supabase. */
const fetchFromServer = async (): Promise<ParkingHistoryItem[]> => {
  try {
    if (!AuthService.isAuthenticated()) return [];
    const supabase = AuthService.getSupabaseClient();
    const { data, error } = await supabase
      .from('parking_location_history')
      .select('*')
      .order('parked_at', { ascending: false })
      .limit(1000);

    if (error || !data || data.length === 0) return [];
    return data.map(serverRowToHistoryItem);
  } catch (e) {
    log.debug('Fetch from server failed (non-fatal)', e);
    return [];
  }
};

/**
 * Merge server records into local records, deduplicating by timestamp proximity.
 * Two records are considered duplicates if their timestamps are within 5 minutes
 * of each other. Local records take priority (they have the most accurate data).
 */
const mergeHistories = (local: ParkingHistoryItem[], server: ParkingHistoryItem[]): ParkingHistoryItem[] => {
  const DEDUP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  // Start with all local items
  const merged = [...local];
  const localTimestamps = local.map(item => item.timestamp);

  // Add server items that don't have a local duplicate
  for (const serverItem of server) {
    const isDuplicate = localTimestamps.some(
      localTs => Math.abs(localTs - serverItem.timestamp) < DEDUP_THRESHOLD_MS
    );
    if (!isDuplicate) {
      merged.push(serverItem);
    }
  }

  // Sort by timestamp descending
  merged.sort((a, b) => b.timestamp - a.timestamp);
  return merged;
};

/**
 * Bulk-sync all local history items to the server.
 * The server deduplicates by timestamp + location proximity, so this is
 * safe to call repeatedly. Runs on every app open to guarantee local
 * history always reaches the database.
 */
const BULK_SYNC_BATCH_SIZE = 500; // items per request

const bulkSyncToServer = async (items: ParkingHistoryItem[]): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated() || items.length === 0) return;

    const { default: ApiClient } = require('../utils/ApiClient');

    let totalSynced = 0;
    let totalSkipped = 0;
    let batchesFailed = 0;

    // Chunk items to avoid hitting body size limits or timing out on large histories
    for (let i = 0; i < items.length; i += BULK_SYNC_BATCH_SIZE) {
      const batch = items.slice(i, i + BULK_SYNC_BATCH_SIZE);
      const payload = batch.map(item => ({
        latitude: item.coords.latitude,
        longitude: item.coords.longitude,
        address: item.address || undefined,
        timestamp: item.timestamp,
        rules: item.rules.map(r => ({ type: r.type, message: r.message, severity: r.severity })),
        departure: item.departure ? {
          confirmedAt: item.departure.confirmedAt,
          distanceMeters: item.departure.distanceMeters,
          isConclusive: item.departure.isConclusive,
          latitude: item.departure.latitude,
          longitude: item.departure.longitude,
        } : undefined,
      }));

      try {
        const response = await ApiClient.authPost('/api/mobile/sync-parking-history', {
          items: payload,
        }, { retries: 2, timeout: 30000, showErrorAlert: false });

        if (response.success && response.data) {
          totalSynced += response.data.synced || 0;
          totalSkipped += response.data.skipped || 0;
        } else {
          batchesFailed++;
          log.warn(`Bulk sync batch ${i / BULK_SYNC_BATCH_SIZE + 1} failed`, response.error);
          // Don't bail out — try the next batch. Server dedupes so re-running is safe.
        }
      } catch (batchErr) {
        batchesFailed++;
        log.warn(`Bulk sync batch ${i / BULK_SYNC_BATCH_SIZE + 1} exception`, batchErr);
      }
    }

    log.info(`Bulk sync complete: ${totalSynced} synced, ${totalSkipped} skipped, ${batchesFailed} batches failed (${items.length} local items)`);

    // Record last successful sync for health monitoring
    if (totalSynced > 0 || batchesFailed === 0) {
      try {
        await AsyncStorage.setItem('parking_history_last_bulk_sync', new Date().toISOString());
      } catch { /* non-fatal */ }
    }

    // If any batch failed, reset the session flag so a retry happens next session
    if (batchesFailed > 0) {
      _bulkSyncCompleted = false;
    }
  } catch (e) {
    log.warn('Bulk sync exception (non-fatal)', e);
    _bulkSyncCompleted = false;
  }
};

// Track whether we've already synced this session
let _bulkSyncCompleted = false;

// ──────────────────────────────────────────────────────
// Service to manage parking history (local-first + server sync)
// ──────────────────────────────────────────────────────

// Track whether we've already merged with the server this session.
// Prevents hitting Supabase on every getHistory() call — the merge
// only needs to happen once (or on explicit pull-to-refresh).
let _serverMergeCompleted = false;

export const ParkingHistoryService = {
  async getHistory(forceServerRefresh: boolean = false): Promise<ParkingHistoryItem[]> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const local: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];

      // Merge with server records when authenticated.
      // This handles: app reinstalls, cleared AsyncStorage, new device,
      // and the 24-day gap where server saves were broken but older records exist.
      // Only fetch from server once per session unless explicitly refreshed.
      const shouldFetchServer = AuthService.isAuthenticated() && (!_serverMergeCompleted || forceServerRefresh);
      if (shouldFetchServer) {
        const serverItems = await fetchFromServer();
        _serverMergeCompleted = true;
        if (serverItems.length > 0) {
          const merged = mergeHistories(local, serverItems);
          // Persist merged list so subsequent reads are fast (no server round-trip)
          if (merged.length > local.length) {
            await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
            log.info(`Merged history: ${local.length} local + ${serverItems.length} server → ${merged.length} total`);
          }

          // Bulk-sync local history to server (once per session, non-blocking).
          // This is how local-only history reaches the database. The server
          // deduplicates, so this is safe to call on every app open.
          if (!_bulkSyncCompleted) {
            _bulkSyncCompleted = true;
            void bulkSyncToServer(merged);
          }

          return merged;
        }
      }

      // Even if server fetch was skipped or returned empty, still bulk-sync
      // local items to server. This covers users who have local history but
      // nothing on the server (the exact bug that lost months of history).
      if (!_bulkSyncCompleted && local.length > 0 && AuthService.isAuthenticated()) {
        _bulkSyncCompleted = true;
        void bulkSyncToServer(local);
      }

      return local;
    } catch (error) {
      log.error('Error getting parking history', error);
      return [];
    }
  },

  async addToHistory(
    coords: Coordinates,
    rules: ParkingRule[],
    address?: string,
    nativeTimestamp?: number,
    detectionMeta?: ParkingHistoryItem['detectionMeta']
  ): Promise<void> {
    try {
      // Read existing history directly (avoid `this` binding issues when called cross-module)
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];

      // Use the native event timestamp (when the car actually stopped) if available,
      // otherwise fall back to Date.now() (when the check completed).
      // On iOS, the native timestamp comes from CoreMotion/GPS detection and is
      // typically 30-120s earlier than Date.now() due to detection + API delays.
      const parkTime = nativeTimestamp || Date.now();
      if (nativeTimestamp) {
        const delayMs = Date.now() - nativeTimestamp;
        log.info(`Using native timestamp for parking time (${Math.round(delayMs / 1000)}s more accurate than Date.now())`);
      }

      // Never store raw coordinates as the address — use a user-friendly fallback
      let displayAddress = address;
      if (!displayAddress || isCoordinateAddress(displayAddress)) {
        displayAddress = formatCoordinateFallback(coords.latitude, coords.longitude);
      }

      const newItem: ParkingHistoryItem = {
        id: Date.now().toString(),
        coords,
        address: displayAddress,
        rules,
        timestamp: parkTime,
        detectionMeta,
      };

      const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');
      log.info(`Saved to parking history: "${newItem.address}" (${rules.length} rules, ${updated.length} total items)`);

      // Direct-to-Supabase fallback: BackgroundTaskService.saveParkedLocationToServer
      // is SUPPOSED to handle server saves, but it has repeatedly failed silently
      // (FCM gate, auth expiry, queuing to AsyncStorage that gets lost on app delete).
      // This is our belt-and-suspenders guarantee that history is NEVER lost.
      // The server-side dedup (5-min window + 200m proximity) handles duplicates.
      void syncAddToServer(newItem);
    } catch (error) {
      log.error('Error adding to parking history', error);
    }
  },

  async clearHistory(): Promise<void> {
    try {
      // Safety: push any unsynced local items to server BEFORE wiping.
      // Server has dedup so this is safe. This prevents local-only data
      // (e.g. something saved in the last minute) from being lost if the
      // user clears before bulk sync runs.
      try {
        const stored = await AsyncStorage.getItem(HISTORY_KEY);
        const local: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
        if (local.length > 0 && AuthService.isAuthenticated()) {
          log.info(`clearHistory: flushing ${local.length} items to server before wipe`);
          await bulkSyncToServer(local);
        }
      } catch (flushErr) {
        log.warn('clearHistory: flush-before-wipe failed, continuing anyway', flushErr);
      }

      await AsyncStorage.removeItem(HISTORY_KEY);
      AppEvents.emit('parking-history-updated');
    } catch (error) {
      log.error('Error clearing parking history', error);
    }
  },

  async deleteItem(id: string): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      const updated = history.filter(item => item.id !== id);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');
    } catch (error) {
      log.error('Error deleting history item', error);
    }
  },

  async updateItem(id: string, updates: Partial<ParkingHistoryItem>): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      const updated = history.map(item =>
        item.id === id ? { ...item, ...updates } : item
      );
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');

      const updatedItem = updated.find(item => item.id === id);
      if (!updatedItem) return;

      // Sync ALL server-relevant updates so server doesn't fall behind local.
      // Data protection: every local improvement must reach the DB.
      if (updates.address || updates.coords) {
        void syncUpdateToServer(updatedItem, {
          address: updates.address,
          coords: updates.coords,
        });
      }
      if (updates.departure) {
        void syncDepartureToServer(updatedItem);
      }
    } catch (error) {
      log.error('Error updating history item', error);
    }
  },

  /** Find the most recent history item (to attach departure data to) */
  async getMostRecent(): Promise<ParkingHistoryItem | null> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      return history.length > 0 ? history[0] : null;
    } catch (error) {
      log.error('Error getting most recent history item', error);
      return null;
    }
  },

  /**
   * Find the history item matching an active parking event so its address can
   * be patched after a user correction. Match key: most-recent item whose
   * coords are within 500m of `originalCoords` and whose timestamp is within
   * the last 6h. The 500m radius mirrors the duplicate-park guard, and the
   * 6h ceiling avoids rewriting an unrelated old entry on the same block.
   */
  async findMatchForCorrection(
    originalCoords: Coordinates,
    referenceTimestamp: number,
  ): Promise<ParkingHistoryItem | null> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      if (history.length === 0) return null;
      const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
      const RADIUS_METERS = 500;
      const candidates = history.filter(item => {
        if (Math.abs(referenceTimestamp - item.timestamp) > SIX_HOURS_MS) return false;
        const d = distanceMeters(
          originalCoords.latitude, originalCoords.longitude,
          item.coords.latitude, item.coords.longitude,
        );
        return d <= RADIUS_METERS;
      });
      if (candidates.length === 0) return null;
      return candidates.sort((a, b) => b.timestamp - a.timestamp)[0];
    } catch (error) {
      log.error('Error finding history match for correction', error);
      return null;
    }
  },

  /**
   * Backfill addresses for history entries that only have coordinates.
   * Runs once per app session — resolves "Near X, Y" and raw coordinate
   * entries by calling client-side reverse geocoding (Nominatim).
   * This fixes existing entries from yesterday/today that were saved
   * before the client-side geocoding fallback was added.
   */
  async backfillCoordinateAddresses(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      if (!stored) return;
      const history: ParkingHistoryItem[] = JSON.parse(stored);

      // Find entries that need backfill (coordinate-only addresses)
      const needsBackfill = history.filter(item =>
        !item.address || isCoordinateAddress(item.address)
      );
      if (needsBackfill.length === 0) return;

      log.info(`Address backfill: ${needsBackfill.length} entries need resolution`);

      let resolvedCount = 0;
      for (const item of needsBackfill) {
        try {
          const resolved = await resolveAddress(
            item.address,
            item.coords.latitude,
            item.coords.longitude
          );
          // Only update if we got a real address (not another "Near X, Y")
          if (resolved && !isCoordinateAddress(resolved)) {
            item.address = resolved;
            resolvedCount++;
            log.info(`Backfill resolved: "${resolved}" for ${item.coords.latitude.toFixed(4)}, ${item.coords.longitude.toFixed(4)}`);
          }
          // Rate limit: 1 request per second to be kind to Nominatim
          await new Promise(resolve => setTimeout(resolve, 1100));
        } catch (e) {
          log.warn('Backfill failed for entry', e);
        }
      }

      if (resolvedCount > 0) {
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        AppEvents.emit('parking-history-updated');
        log.info(`Address backfill complete: ${resolvedCount}/${needsBackfill.length} resolved`);
      }
    } catch (error) {
      log.error('Address backfill failed (non-fatal)', error);
    }
  },

  /** Get diagnostic summary of local history state (for log collection). */
  async getDiagnosticSummary(): Promise<string> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      if (history.length === 0) return 'Local history: EMPTY';

      const newest = history[0];
      const oldest = history[history.length - 1];
      const newestDate = new Date(newest.timestamp).toISOString();
      const oldestDate = new Date(oldest.timestamp).toISOString();
      return `Local history: ${history.length} items, newest=${newestDate} (${newest.address}), oldest=${oldestDate}`;
    } catch (e) {
      return `Local history: ERROR reading (${e})`;
    }
  },
};

// ──────────────────────────────────────────────────────
// Stats Header Component
// ──────────────────────────────────────────────────────
interface StatsProps {
  totalChecks: number;
  violationsFound: number;
  estimatedSaved: number;
}

const StatsHeader: React.FC<StatsProps> = ({ totalChecks, violationsFound, estimatedSaved }) => (
  <View style={styles.statsCard}>
    <View style={styles.statItem}>
      <MaterialCommunityIcons name="map-marker-check" size={20} color={colors.primary} />
      <Text style={styles.statValue}>{totalChecks}</Text>
      <Text style={styles.statLabel}>Checks</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.warning} />
      <Text style={styles.statValue}>{violationsFound}</Text>
      <Text style={styles.statLabel}>Alerts</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <MaterialCommunityIcons name="piggy-bank-outline" size={20} color={colors.success} />
      <Text style={[styles.statValue, styles.statHighlight]}>
        ~${estimatedSaved}
      </Text>
      <Text style={styles.statLabel}>Saved</Text>
    </View>
  </View>
);


// ──────────────────────────────────────────────────────
// Unified Camera Event (Speed + Red Light combined)
// ──────────────────────────────────────────────────────
type UnifiedCameraEvent =
  | { eventType: 'speed'; data: CameraPassHistoryItem }
  | { eventType: 'redlight'; data: RedLightReceipt };

const getEventTimestamp = (event: UnifiedCameraEvent): number =>
  event.eventType === 'speed' ? event.data.timestamp : event.data.deviceTimestamp;

const getEventId = (event: UnifiedCameraEvent): string => event.data.id;

const formatRelativeTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getSpeedSeverity = (delta: number | null): { color: string; label: string } => {
  if (delta == null || delta <= 0) return { color: '#34C759', label: 'ok' };
  if (delta <= 10) return { color: '#FF9500', label: 'warning' };
  return { color: '#FF3B30', label: 'danger' };
};

const getRedLightSeverity = (item: RedLightReceipt): { color: string; label: string } => {
  if (item.fullStopDetected && item.fullStopDurationSec != null && item.fullStopDurationSec >= 1.0) {
    return { color: '#34C759', label: 'ok' };
  }
  if (item.fullStopDetected) return { color: '#FF9500', label: 'warning' };
  return { color: '#FF3B30', label: 'danger' };
};

interface CameraEventCardProps {
  event: UnifiedCameraEvent;
  isExpanded: boolean;
  onToggle: () => void;
}

const CameraEventCard: React.FC<CameraEventCardProps> = ({ event, isExpanded, onToggle }) => {
  const isSpeed = event.eventType === 'speed';
  const timestamp = getEventTimestamp(event);
  const address = event.data.cameraAddress;

  // Severity
  const severity = isSpeed
    ? getSpeedSeverity((event.data as CameraPassHistoryItem).speedDeltaMph != null ? Math.round((event.data as CameraPassHistoryItem).speedDeltaMph!) : null)
    : getRedLightSeverity(event.data as RedLightReceipt);

  // Hero metric
  let heroText: string;
  let heroColor: string;
  if (isSpeed) {
    const spd = event.data as CameraPassHistoryItem;
    const delta = spd.speedDeltaMph != null ? Math.round(spd.speedDeltaMph) : null;
    if (delta == null) {
      heroText = 'Unknown';
      heroColor = colors.textSecondary;
    } else if (delta <= 0) {
      heroText = 'Under limit';
      heroColor = '#34C759';
    } else {
      heroText = `${delta} over`;
      heroColor = severity.color;
    }
  } else {
    const rl = event.data as RedLightReceipt;
    if (rl.fullStopDetected && rl.fullStopDurationSec != null) {
      heroText = `Stopped ${rl.fullStopDurationSec.toFixed(1)}s`;
      heroColor = severity.color;
    } else {
      heroText = 'No stop';
      heroColor = '#FF3B30';
    }
  }

  return (
    <TouchableOpacity
      style={cameraCardStyles.container}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      {/* Severity strip */}
      <View style={[cameraCardStyles.severityStrip, { backgroundColor: severity.color }]} />

      <View style={cameraCardStyles.content}>
        {/* Collapsed row */}
        <View style={cameraCardStyles.collapsedRow}>
          <MaterialCommunityIcons
            name={isSpeed ? 'speedometer' : 'traffic-light'}
            size={18}
            color={severity.color}
            style={cameraCardStyles.icon}
          />
          <View style={cameraCardStyles.textCol}>
            <Text style={cameraCardStyles.address} numberOfLines={1}>{address}</Text>
            <Text style={[cameraCardStyles.hero, { color: heroColor }]}>{heroText}</Text>
          </View>
          <View style={cameraCardStyles.rightCol}>
            <Text style={cameraCardStyles.relTime}>{formatRelativeTime(timestamp)}</Text>
            <MaterialCommunityIcons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textTertiary}
            />
          </View>
        </View>

        {/* Expanded details */}
        {isExpanded && (
          <View style={cameraCardStyles.expandedSection}>
            <Text style={cameraCardStyles.fullTimestamp}>
              {formatDate(timestamp)} {formatTime(timestamp)}
            </Text>

            {isSpeed ? (() => {
              const spd = event.data as CameraPassHistoryItem;
              const speedText = spd.userSpeedMph != null ? `${Math.round(spd.userSpeedMph)} mph` : 'N/A';
              const limitText = spd.expectedSpeedMph != null ? `${Math.round(spd.expectedSpeedMph)} mph` : 'N/A';
              const delta = spd.speedDeltaMph != null ? Math.round(spd.speedDeltaMph) : null;
              const deltaText = delta == null ? 'N/A' : delta > 0 ? `+${delta} mph` : `${delta} mph`;
              const deltaColor = delta == null ? colors.textSecondary : delta > 0 ? severity.color : '#34C759';
              return (
                <View style={cameraCardStyles.pillRow}>
                  <View style={cameraCardStyles.pill}>
                    <Text style={cameraCardStyles.pillLabel}>Your speed</Text>
                    <Text style={cameraCardStyles.pillValue}>{speedText}</Text>
                  </View>
                  <View style={cameraCardStyles.pill}>
                    <Text style={cameraCardStyles.pillLabel}>Limit</Text>
                    <Text style={cameraCardStyles.pillValue}>{limitText}</Text>
                  </View>
                  <View style={cameraCardStyles.pill}>
                    <Text style={cameraCardStyles.pillLabel}>Delta</Text>
                    <Text style={[cameraCardStyles.pillValue, { color: deltaColor }]}>{deltaText}</Text>
                  </View>
                </View>
              );
            })() : (() => {
              const rl = event.data as RedLightReceipt;
              const approach = rl.approachSpeedMph != null ? `${Math.round(rl.approachSpeedMph)} mph` : 'N/A';
              const minSpd = rl.minSpeedMph != null ? `${Math.round(rl.minSpeedMph)} mph` : 'N/A';
              const accuracy = rl.estimatedSpeedAccuracyMph != null ? `\u00B1${rl.estimatedSpeedAccuracyMph.toFixed(1)} mph` : 'N/A';
              const stopText = rl.fullStopDetected && rl.fullStopDurationSec != null
                ? `Stopped ${rl.fullStopDurationSec.toFixed(1)}s`
                : 'No full stop detected';
              const timeline = RedLightReceiptService.buildTimelineSummary(rl);
              return (
                <>
                  <View style={cameraCardStyles.pillRow}>
                    <View style={cameraCardStyles.pill}>
                      <Text style={cameraCardStyles.pillLabel}>Approach</Text>
                      <Text style={cameraCardStyles.pillValue}>{approach}</Text>
                    </View>
                    <View style={cameraCardStyles.pill}>
                      <Text style={cameraCardStyles.pillLabel}>Min speed</Text>
                      <Text style={cameraCardStyles.pillValue}>{minSpd}</Text>
                    </View>
                    <View style={cameraCardStyles.pill}>
                      <Text style={cameraCardStyles.pillLabel}>Accuracy</Text>
                      <Text style={cameraCardStyles.pillValue}>{accuracy}</Text>
                    </View>
                  </View>
                  <Text style={cameraCardStyles.stopText}>{stopText}</Text>
                  <Text style={cameraCardStyles.timelineText}>{timeline}</Text>
                </>
              );
            })()}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const cameraCardStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadows.sm,
  },
  severityStrip: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: spacing.sm,
  },
  textCol: {
    flex: 1,
  },
  address: {
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    fontWeight: typography.weights.medium,
  },
  hero: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    marginTop: 2,
  },
  rightCol: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  relTime: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  expandedSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fullTimestamp: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    alignItems: 'center',
  },
  pillLabel: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  pillValue: {
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    fontWeight: typography.weights.semibold,
  },
  stopText: {
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    fontWeight: typography.weights.medium,
    marginTop: spacing.sm,
  },
  timelineText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
  },
});

interface UnifiedCameraSection {
  title: string;
  data: UnifiedCameraEvent[];
}

const groupUnifiedCameraByDate = (events: UnifiedCameraEvent[]): UnifiedCameraSection[] => {
  const map = new Map<string, UnifiedCameraEvent[]>();
  for (const ev of events) {
    const key = getDateKey(getEventTimestamp(ev));
    const group = map.get(key);
    if (group) {
      group.push(ev);
    } else {
      map.set(key, [ev]);
    }
  }
  return Array.from(map.entries()).map(([, grouped]) => ({
    title: formatSectionDate(getEventTimestamp(grouped[0])),
    data: grouped,
  }));
};

// ──────────────────────────────────────────────────────
// Timeline Item Component
// ──────────────────────────────────────────────────────
interface TimelineItemProps {
  item: ParkingHistoryItem;
  isExpanded: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  isExpanded,
  isFirst,
  isLast,
  onPress,
  onLongPress,
}) => {
  const hasViolations = item.rules.length > 0;
  const hasCritical = item.rules.some(r => r.severity === 'critical');

  const dotColor = hasCritical
    ? colors.error
    : hasViolations
      ? colors.warning
      : colors.success;

  return (
    <TouchableOpacity
      style={styles.timelineRow}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Parking check at ${item.address || 'saved location'}. ${hasViolations ? `${item.rules.length} issues found` : 'Clear'}`}
      accessibilityHint={isExpanded ? 'Tap to collapse. Hold to delete.' : 'Tap to expand. Hold to delete.'}
    >
      {/* Timeline spine */}
      <View style={styles.timelineSpine}>
        {!isFirst && <View style={[styles.timelineLine, styles.timelineLineTop]} />}
        <View style={[styles.timelineDot, { backgroundColor: dotColor }]}>
          <MaterialCommunityIcons
            name={hasViolations ? 'alert' : 'check'}
            size={10}
            color={colors.white}
          />
        </View>
        {!isLast && <View style={[styles.timelineLine, styles.timelineLineBottom]} />}
      </View>

      {/* Content card */}
      <View style={[styles.timelineCard, isExpanded && styles.timelineCardExpanded]}>
        <View style={styles.timelineHeader}>
          <View style={styles.timelineDateWrap}>
            <Text style={styles.timelineTime}>{formatTime(item.timestamp)}</Text>
            <Text style={styles.timelineDate}>{formatDate(item.timestamp)}</Text>
          </View>
          <StatusBadge
            text={hasViolations ? `${item.rules.length} issue${item.rules.length > 1 ? 's' : ''}` : 'Clear'}
            variant={hasCritical ? 'error' : hasViolations ? 'warning' : 'success'}
          />
        </View>

        <View style={styles.timelineAddress}>
          <MaterialCommunityIcons name="map-marker" size={14} color={colors.textTertiary} />
          <Text style={styles.timelineAddressText} numberOfLines={isExpanded ? 3 : 1}>
            {item.address && !isCoordinateAddress(item.address)
              ? item.address
              : formatCoordinateFallback(item.coords.latitude, item.coords.longitude)}
          </Text>
        </View>

        {/* Expanded: rules */}
        {isExpanded && item.rules.length > 0 && (
          <View style={styles.timelineRules}>
            {item.rules.map((rule, index) => (
              <RuleCard key={index} rule={rule} />
            ))}
          </View>
        )}

        {isExpanded && item.rules.length === 0 && (
          <View style={styles.timelineClear}>
            <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
            <Text style={styles.timelineClearText}>No parking restrictions found</Text>
          </View>
        )}

        {/* Expanded: departure record */}
        {isExpanded && item.departure && (
          <View style={styles.departureSection}>
            <View style={styles.departureRow}>
              <MaterialCommunityIcons
                name={item.departure.isConclusive ? 'location-exit' : 'map-marker-radius'}
                size={16}
                color={item.departure.isConclusive ? colors.success : colors.warning}
              />
              <View style={styles.departureInfo}>
                <Text style={styles.departureText}>
                  Left at {formatTime(item.departure.confirmedAt)}
                </Text>
                <Text style={[
                  styles.departureStatus,
                  { color: item.departure.isConclusive ? colors.success : colors.warning },
                ]}>
                  {item.departure.isConclusive
                    ? 'GPS-verified departure'
                    : 'Still near parking spot'}
                </Text>
              </View>
            </View>
            <Text style={styles.departureExplainer}>
              Departure records help you contest unfair tickets by proving when you left.
            </Text>
          </View>
        )}

        {/* Expanded: no departure data */}
        {isExpanded && !item.departure && (
          <View style={styles.noDepartureRow}>
            <MaterialCommunityIcons name="car-off" size={14} color={colors.textTertiary} />
            <Text style={styles.noDepartureText}>Departure not recorded</Text>
          </View>
        )}

        {/* Expanded: action buttons (map + share) */}
        {isExpanded && (
          <View style={styles.historyActions}>
            <TouchableOpacity
              style={styles.historyActionBtn}
              onPress={() => {
                const { latitude, longitude } = item.coords;
                const url = Platform.select({
                  ios: `http://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(item.address || 'Parking spot')}`,
                  android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(item.address || 'Parking spot')})`,
                });
                if (url) Linking.openURL(url).catch((e) => log.debug('Failed to open maps URL', e));
              }}
            >
              <MaterialCommunityIcons name="map-outline" size={14} color={colors.primary} />
              <Text style={styles.historyActionText}>Open in Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.historyActionBtn}
              onPress={async () => {
                const status = item.rules.length > 0
                  ? `${item.rules.length} restriction${item.rules.length > 1 ? 's' : ''}`
                  : 'All clear';
                const mapUrl = `https://maps.google.com/?q=${item.coords.latitude},${item.coords.longitude}`;
                const msg = `${status} at ${item.address || 'my parking spot'} (${formatDate(item.timestamp)} ${formatTime(item.timestamp)})\n${mapUrl}`;
                try { await Share.share({ message: msg }); } catch { /* cancelled */ }
              }}
            >
              <MaterialCommunityIcons name="share-variant" size={14} color={colors.primary} />
              <Text style={styles.historyActionText}>Share</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Expand hint */}
        <View style={styles.expandRow}>
          <MaterialCommunityIcons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textTertiary}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ──────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────
const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatSectionDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

/** Get a date key (YYYY-MM-DD) for grouping */
const getDateKey = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface HistorySection {
  title: string;
  data: ParkingHistoryItem[];
}

/** Group a flat history array into sections by date */
const groupByDate = (items: ParkingHistoryItem[]): HistorySection[] => {
  const map = new Map<string, ParkingHistoryItem[]>();
  for (const item of items) {
    const key = getDateKey(item.timestamp);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  // Items are already in reverse-chronological order, so sections come out
  // in the right order (most recent date first).
  return Array.from(map.entries()).map(([, grouped]) => ({
    title: formatSectionDate(grouped[0].timestamp),
    data: grouped,
  }));
};


// ──────────────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────────────
const HistoryScreen: React.FC = () => {
  const navigation = useNavigation();
  const [history, setHistory] = useState<ParkingHistoryItem[]>([]);
  const [cameraPassHistory, setCameraPassHistory] = useState<CameraPassHistoryItem[]>([]);
  const [redLightReceipts, setRedLightReceipts] = useState<RedLightReceipt[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'parking' | 'cameras'>('parking');
  const [cameraSubTab, setCameraSubTab] = useState<'speed' | 'redlight'>('speed');
  const [expandedCameraId, setExpandedCameraId] = useState<string | null>(null);
  const [, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const isMountedRef = useRef(true);
  const deletingIdRef = useRef<string | null>(null);
  const clearingRef = useRef(false);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const loadHistory = useCallback(async (forceServerRefresh: boolean = false) => {
    try {
      const items = await ParkingHistoryService.getHistory(forceServerRefresh);
      const passItems = await CameraPassHistoryService.getHistory();
      const receiptItems = await RedLightReceiptService.getReceipts();
      if (isMountedRef.current) setHistory(items);
      if (isMountedRef.current) setCameraPassHistory(passItems);
      if (isMountedRef.current) setRedLightReceipts(receiptItems);
    } catch (error) {
      log.error('Error loading history', error);
    }
  }, []);

  useEffect(() => {
    const initLoad = async () => {
      await loadHistory();
      if (isMountedRef.current) setIsInitialLoading(false);
      // Backfill coordinate-only addresses in the background (runs once per session).
      // Non-blocking — will emit 'parking-history-updated' when done, which triggers loadHistory.
      ParkingHistoryService.backfillCoordinateAddresses().catch(() => {});
    };
    initLoad();
  }, [loadHistory]);

  // Reload history when switching to this tab (catches background parking events)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadHistory();
      // Track how many history items the user sees
      void AnalyticsService.logViewParkingHistory(history.length);
    });
    return unsubscribe;
  }, [navigation, loadHistory, history.length]);

  useEffect(() => {
    const offParking = AppEvents.on('parking-history-updated', loadHistory);
    const offCamera = AppEvents.on('camera-pass-history-updated', loadHistory);
    const offRedLight = AppEvents.on('red-light-receipts-updated', loadHistory);
    return () => {
      offParking();
      offCamera();
      offRedLight();
    };
  }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Process any queued parking saves before refreshing history
    try {
      const ParkingSaveQueue = require('../services/ParkingSaveQueue').default;
      await ParkingSaveQueue.processQueue();
    } catch { /* non-fatal */ }
    await loadHistory(true); // Force server refresh on pull-to-refresh
    if (isMountedRef.current) setRefreshing(false);
  }, [loadHistory]);

  const clearAllHistory = useCallback(() => {
    if (clearingRef.current) return;
    const isParkingView = activeView === 'parking';
    const label = isParkingView ? 'Parking' : cameraSubTab === 'speed' ? 'Speed Camera' : 'Red Light Camera';
    Alert.alert(
      `Clear ${label} History`,
      `Are you sure you want to clear all ${label.toLowerCase()} history?`,
      [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          clearingRef.current = true;
          if (isMountedRef.current) setIsClearing(true);
          try {
            if (isParkingView) {
              await ParkingHistoryService.clearHistory();
              if (isMountedRef.current) setHistory([]);
            } else if (cameraSubTab === 'speed') {
              await CameraPassHistoryService.clearHistory();
              if (isMountedRef.current) setCameraPassHistory([]);
            } else {
              await RedLightReceiptService.clearReceipts();
              if (isMountedRef.current) setRedLightReceipts([]);
            }
          } catch (error) {
            log.error('Error clearing history', error);
            if (isMountedRef.current) Alert.alert('Error', 'Failed to clear history.');
          } finally {
            clearingRef.current = false;
            if (isMountedRef.current) setIsClearing(false);
          }
        },
      },
    ]);
  }, [activeView, cameraSubTab]);

  const deleteItem = useCallback((id: string) => {
    if (deletingIdRef.current !== null) return;
    Alert.alert('Delete Entry', 'Remove this parking entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          deletingIdRef.current = id;
          if (isMountedRef.current) setIsDeleting(true);
          try {
            await ParkingHistoryService.deleteItem(id);
            if (isMountedRef.current) setHistory(prev => prev.filter(item => item.id !== id));
          } catch (error) {
            log.error('Error deleting', error);
            if (isMountedRef.current) Alert.alert('Error', 'Failed to delete.');
          } finally {
            deletingIdRef.current = null;
            if (isMountedRef.current) setIsDeleting(false);
          }
        },
      },
    ]);
  }, []);

  // Compute stats from history
  const stats = useMemo(() => {
    const violations = history.filter(item => item.rules.length > 0).length;
    return {
      totalChecks: history.length,
      violationsFound: violations,
      estimatedSaved: Math.floor(violations * Config.STATS.VIOLATION_TO_TICKET_RATE) * Config.STATS.AVERAGE_TICKET_COST,
    };
  }, [history]);

  // Group history items into date sections
  const sections = useMemo(() => groupByDate(history), [history]);

  // Separate camera events by type for sub-tabs
  const speedCameraEvents = useMemo((): UnifiedCameraEvent[] =>
    cameraPassHistory.map(item => ({ eventType: 'speed' as const, data: item })),
    [cameraPassHistory]
  );
  const redLightCameraEvents = useMemo((): UnifiedCameraEvent[] =>
    redLightReceipts.map(item => ({ eventType: 'redlight' as const, data: item })),
    [redLightReceipts]
  );

  const speedCameraSections = useMemo(
    () => groupUnifiedCameraByDate(speedCameraEvents),
    [speedCameraEvents]
  );
  const redLightCameraSections = useMemo(
    () => groupUnifiedCameraByDate(redLightCameraEvents),
    [redLightCameraEvents]
  );

  const renderTimelineItem = useCallback(({ item, index, section }: {
    item: ParkingHistoryItem;
    index: number;
    section: HistorySection;
  }) => (
    <TimelineItem
      item={item}
      isExpanded={expandedId === item.id}
      isFirst={index === 0}
      isLast={index === section.data.length - 1}
      onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
      onLongPress={() => deleteItem(item.id)}
    />
  ), [expandedId, deleteItem]);

  const renderSectionHeader = useCallback(({ section }: { section: HistorySection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  ), []);

  const renderEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="clock-outline" size={48} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>No history yet</Text>
      <Text style={styles.emptyText}>
        Every time you park, we'll check for restrictions and save the results here. Go park somewhere!
      </Text>
    </View>
  ), []);

  const renderHeader = useCallback(() => {
    if (history.length === 0) return null;
    return <StatsHeader {...stats} />;
  }, [history.length, stats]);

  if (isInitialLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>History</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        {((activeView === 'parking' && history.length > 0) ||
          (activeView === 'cameras' && cameraSubTab === 'speed' && cameraPassHistory.length > 0) ||
          (activeView === 'cameras' && cameraSubTab === 'redlight' && redLightReceipts.length > 0)) && (
          <TouchableOpacity
            onPress={clearAllHistory}
            disabled={isClearing}
            accessibilityLabel="Clear all history"
            accessibilityRole="button"
          >
            {isClearing ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
            )}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.viewToggleRow}>
        <TouchableOpacity
          style={[styles.viewToggleBtn, activeView === 'parking' && styles.viewToggleBtnActive]}
          onPress={() => { setActiveView('parking'); setExpandedCameraId(null); }}
        >
          <Text style={[styles.viewToggleText, activeView === 'parking' && styles.viewToggleTextActive]}>
            Parking
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewToggleBtn, activeView === 'cameras' && styles.viewToggleBtnActive]}
          onPress={() => { setActiveView('cameras'); setExpandedId(null); }}
        >
          <Text style={[styles.viewToggleText, activeView === 'cameras' && styles.viewToggleTextActive]}>
            Cameras
          </Text>
        </TouchableOpacity>
      </View>

      {activeView === 'parking' && history.length === 0 ? (
        <>
          {renderHeader()}
          {renderEmptyState()}
        </>
      ) : activeView === 'parking' ? (
        <SectionList
          sections={sections}
          renderItem={renderTimelineItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={renderHeader}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      ) : (
        <>
          {/* Camera sub-tabs: Speed | Red Light */}
          <View style={styles.cameraSubTabRow}>
            <TouchableOpacity
              style={[styles.cameraSubTabBtn, cameraSubTab === 'speed' && styles.cameraSubTabBtnActive]}
              onPress={() => { setCameraSubTab('speed'); setExpandedCameraId(null); }}
            >
              <MaterialCommunityIcons name="speedometer" size={14} color={cameraSubTab === 'speed' ? colors.white : colors.textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.cameraSubTabText, cameraSubTab === 'speed' && styles.cameraSubTabTextActive]}>
                Speed
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cameraSubTabBtn, cameraSubTab === 'redlight' && styles.cameraSubTabBtnActive]}
              onPress={() => { setCameraSubTab('redlight'); setExpandedCameraId(null); }}
            >
              <MaterialCommunityIcons name="traffic-light" size={14} color={cameraSubTab === 'redlight' ? colors.white : colors.textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.cameraSubTabText, cameraSubTab === 'redlight' && styles.cameraSubTabTextActive]}>
                Red Light
              </Text>
            </TouchableOpacity>
          </View>

          {cameraSubTab === 'speed' && speedCameraEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="speedometer" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No speed camera events yet</Text>
              <Text style={styles.emptyText}>
                Drive with camera alerts enabled and we&apos;ll record your speed when you pass speed camera locations.
              </Text>
            </View>
          ) : cameraSubTab === 'speed' ? (
            <SectionList
              sections={speedCameraSections}
              renderItem={({ item }) => (
                <CameraEventCard
                  event={item}
                  isExpanded={expandedCameraId === getEventId(item)}
                  onToggle={() => setExpandedCameraId(expandedCameraId === getEventId(item) ? null : getEventId(item))}
                />
              )}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{section.title}</Text>
                </View>
              )}
              keyExtractor={(item) => getEventId(item)}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
              }
              showsVerticalScrollIndicator={false}
              stickySectionHeadersEnabled={false}
            />
          ) : redLightCameraEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="traffic-light" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No red light camera events yet</Text>
              <Text style={styles.emptyText}>
                Drive with camera alerts enabled and we&apos;ll record your stop data when you pass red light camera locations.
              </Text>
            </View>
          ) : (
            <SectionList
              sections={redLightCameraSections}
              renderItem={({ item }) => (
                <CameraEventCard
                  event={item}
                  isExpanded={expandedCameraId === getEventId(item)}
                  onToggle={() => setExpandedCameraId(expandedCameraId === getEventId(item) ? null : getEventId(item))}
                />
              )}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{section.title}</Text>
                </View>
              )}
              keyExtractor={(item) => getEventId(item)}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
              }
              showsVerticalScrollIndicator={false}
              stickySectionHeadersEnabled={false}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  viewToggleRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: 4,
  },
  viewToggleBtn: {
    flex: 1,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  viewToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  viewToggleText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  viewToggleTextActive: {
    color: colors.white,
  },
  cameraSubTabRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  cameraSubTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.cardBg,
  },
  cameraSubTabBtnActive: {
    backgroundColor: colors.primary,
  },
  cameraSubTabText: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  cameraSubTabTextActive: {
    color: colors.white,
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Stats header
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  statHighlight: {
    color: colors.success,
  },
  statLabel: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },

  // Section headers
  sectionHeader: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    paddingLeft: 32 + spacing.sm, // align with card content (past the timeline spine)
  },
  sectionHeaderText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Timeline
  timelineRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  timelineSpine: {
    width: 32,
    alignItems: 'center',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
  },
  timelineLineTop: {
    marginBottom: 0,
  },
  timelineLineBottom: {
    marginTop: 0,
  },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  timelineCardExpanded: {
    ...shadows.md,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  timelineDateWrap: {},
  timelineTime: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  timelineDate: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginTop: 1,
  },
  timelineAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  timelineAddressText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  timelineRules: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timelineClear: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timelineClearText: {
    fontSize: typography.sizes.sm,
    color: colors.success,
    fontWeight: typography.weights.medium,
    marginLeft: spacing.sm,
  },

  // Departure
  departureSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  departureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  departureInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  departureText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  departureStatus: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    marginTop: 2,
  },
  departureExplainer: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginLeft: spacing.sm + 16, // align with departure text (icon width + marginLeft)
  },
  noDepartureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  noDepartureText: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },

  // History item actions
  historyActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.sm,
  },
  historyActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colors.primary,
  },

  // Expand hint
  expandRow: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    padding: spacing.xxl,
    marginTop: spacing.xxl,
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
  },
});

export default HistoryScreen;
