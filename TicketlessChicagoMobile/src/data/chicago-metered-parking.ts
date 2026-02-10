/**
 * Chicago metered parking paybox locations.
 *
 * Data source: Chicago Parking Meters LLC (via GitHub GeoJSON, 2019-06-26).
 * ~4,638 active payboxes covering ~36,700 metered parking spaces.
 *
 * Loaded from Supabase via API with 7-day AsyncStorage cache.
 * No hardcoded fallback — meters are only available after the first API fetch.
 * If the FOIA request returns updated data, it will be a database swap with
 * no code changes needed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MeteredParkingLocation {
  meter_id: number;
  address: string;
  latitude: number;
  longitude: number;
  spaces: number;
  status: string;
  meter_type: string;
}

// In-memory store
let meteredParkingLocations: MeteredParkingLocation[] = [];
let fetchAttempted = false;

const CACHE_KEY = '@metered_parking_cache';
const CACHE_TS_KEY = '@metered_parking_cache_ts';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get the current list of metered parking locations.
 * Returns empty array until first successful fetch.
 */
export function getMeteredParkingLocations(): MeteredParkingLocation[] {
  return meteredParkingLocations;
}

/**
 * Fetch metered parking locations from the API with AsyncStorage caching.
 * Fire-and-forget — loads from cache first (fast), then refreshes if stale.
 */
export async function fetchMeteredParkingLocations(): Promise<void> {
  if (fetchAttempted) return;
  fetchAttempted = true;

  try {
    // Step 1: Load from AsyncStorage cache immediately
    const [cachedData, cachedTs] = await Promise.all([
      AsyncStorage.getItem(CACHE_KEY),
      AsyncStorage.getItem(CACHE_TS_KEY),
    ]);

    const cacheAge = cachedTs ? Date.now() - parseInt(cachedTs, 10) : Infinity;

    if (cachedData) {
      const cached: MeteredParkingLocation[] = JSON.parse(cachedData);
      if (cached.length >= 100) {
        meteredParkingLocations = cached;
        console.log(`[MeteredParking] Loaded ${cached.length} from cache (age: ${Math.round(cacheAge / 3600000)}h)`);
      }
    }

    // Step 2: If cache is fresh enough, skip the network call
    if (cacheAge < CACHE_MAX_AGE_MS) {
      return;
    }

    // Step 3: Cache is stale or missing — fetch from API
    console.log('[MeteredParking] Cache stale, fetching from API...');
    const API_URL = 'https://autopilotamerica.com/api/metered-parking';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout (larger dataset)

    const response = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[MeteredParking] API returned ${response.status}, keeping current data`);
      return;
    }

    const data = await response.json();
    if (!data.meters || !Array.isArray(data.meters) || data.meters.length === 0) {
      console.log('[MeteredParking] API returned empty data, keeping current data');
      return;
    }

    // Sanity check — should have thousands of meters
    if (data.meters.length < 1000) {
      console.log(`[MeteredParking] API returned only ${data.meters.length} meters (expected 4000+), keeping current data`);
      return;
    }

    // Update in-memory + persist to cache
    meteredParkingLocations = data.meters;
    await Promise.all([
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data.meters)),
      AsyncStorage.setItem(CACHE_TS_KEY, String(Date.now())),
    ]);
    console.log(`[MeteredParking] Updated to ${data.meters.length} meters from API, cached`);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.log('[MeteredParking] API timed out, keeping current data');
    } else {
      console.log('[MeteredParking] Fetch failed, keeping current data:', error?.message);
    }
  }
}

/**
 * Reset fetch state (for testing or retry).
 */
export function resetMeteredParkingFetch(): void {
  fetchAttempted = false;
  meteredParkingLocations = [];
}
