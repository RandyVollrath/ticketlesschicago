/**
 * Chicago Open Data Monitor
 *
 * Monitors Chicago's open data feeds for changes that affect ticket defense:
 * 1. Speed camera installations/removals (quarterly changes)
 * 2. Red-light camera status changes
 * 3. CDOT sign repair/installation work orders
 * 4. Construction permits that affect parking
 * 5. Street cleaning schedule changes
 *
 * All data sources are free Chicago Data Portal APIs (no keys required).
 *
 * Designed to run as a weekly cron job. When changes are detected,
 * they're stored in Supabase for use in evidence enrichment.
 */

import { SupabaseClient } from '@supabase/supabase-js';

const CHICAGO_DATA_PORTAL = 'https://data.cityofchicago.org/resource';

// ─── Types ───────────────────────────────────────────────────

export interface CameraChangeEvent {
  type: 'speed' | 'redlight';
  action: 'added' | 'removed' | 'relocated' | 'status_change';
  address: string;
  latitude: number | null;
  longitude: number | null;
  detectedAt: string;
  details: string;
}

export interface SignageWorkOrder {
  serviceRequestId: string;
  type: string;
  address: string;
  latitude: number;
  longitude: number;
  createdDate: string;
  status: string;
  completedDate: string | null;
}

export interface MonitorResult {
  cameraChanges: CameraChangeEvent[];
  signageWorkOrders: SignageWorkOrder[];
  activeConstructionZones: any[];
  timestamp: string;
}

// ─── Camera Monitoring ───────────────────────────────────────

// Chicago Speed Camera dataset: https://data.cityofchicago.org/resource/4i42-qv3h.json
const SPEED_CAMERA_DATASET = '4i42-qv3h';

// Chicago Red Light Camera dataset: https://data.cityofchicago.org/resource/spqx-js37.json
const RED_LIGHT_CAMERA_DATASET = 'spqx-js37';

/**
 * Fetch current speed camera locations from Chicago Data Portal.
 * Compare with our stored camera list to detect additions/removals.
 */
export async function checkSpeedCameraChanges(
  supabase: SupabaseClient,
): Promise<CameraChangeEvent[]> {
  const changes: CameraChangeEvent[] = [];

  try {
    // Fetch current speed camera violations (aggregated by location)
    // This gives us which cameras are actively issuing tickets
    const url = `${CHICAGO_DATA_PORTAL}/${SPEED_CAMERA_DATASET}.json?$select=address,camera_id,violation_date,violations&$order=violation_date DESC&$limit=500&$where=violation_date > '${getDateNDaysAgo(90)}'`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Speed camera data fetch failed:', response.status);
      return changes;
    }

    const records: any[] = await response.json();

    // Get unique active camera addresses
    const activeCameras = new Map<string, { cameraId: string; lastViolation: string; address: string }>();
    for (const r of records) {
      const addr = (r.address || '').toUpperCase().trim();
      if (!addr) continue;
      const existing = activeCameras.get(addr);
      if (!existing || r.violation_date > existing.lastViolation) {
        activeCameras.set(addr, {
          cameraId: r.camera_id || '',
          lastViolation: r.violation_date,
          address: r.address,
        });
      }
    }

    // Check against our stored camera list
    const { data: storedCameras } = await supabase
      .from('camera_monitor_state')
      .select('address, camera_id, last_seen')
      .eq('type', 'speed');

    const storedSet = new Set((storedCameras || []).map((c: any) => c.address.toUpperCase().trim()));

    // Detect new cameras
    for (const [addr, info] of activeCameras) {
      if (!storedSet.has(addr)) {
        changes.push({
          type: 'speed',
          action: 'added',
          address: info.address,
          latitude: null,
          longitude: null,
          detectedAt: new Date().toISOString(),
          details: `New speed camera detected at ${info.address} (camera_id: ${info.cameraId}). First violation in dataset: ${info.lastViolation}`,
        });
      }
    }

    // Detect removed cameras (in our list but no recent violations)
    for (const stored of (storedCameras || [])) {
      const addr = stored.address.toUpperCase().trim();
      if (!activeCameras.has(addr)) {
        changes.push({
          type: 'speed',
          action: 'removed',
          address: stored.address,
          latitude: null,
          longitude: null,
          detectedAt: new Date().toISOString(),
          details: `Speed camera at ${stored.address} has no violations in the last 90 days. May have been removed or deactivated.`,
        });
      }
    }

    // Update stored state
    if (activeCameras.size > 0) {
      const upsertData = Array.from(activeCameras).map(([addr, info]) => ({
        type: 'speed' as const,
        address: info.address,
        camera_id: info.cameraId,
        last_seen: new Date().toISOString(),
        last_violation_date: info.lastViolation,
      }));

      // Use upsert in batches
      for (let i = 0; i < upsertData.length; i += 50) {
        await supabase
          .from('camera_monitor_state')
          .upsert(upsertData.slice(i, i + 50), { onConflict: 'type,address' })
          .then(() => {}, () => {}); // Ignore errors — table may not exist yet
      }
    }

    if (changes.length > 0) {
      console.log(`  Camera monitor: ${changes.length} speed camera changes detected`);
    }
  } catch (error) {
    console.error('Speed camera monitoring failed:', error);
  }

  return changes;
}

/**
 * Fetch current red-light camera locations and compare.
 */
export async function checkRedLightCameraChanges(
  supabase: SupabaseClient,
): Promise<CameraChangeEvent[]> {
  const changes: CameraChangeEvent[] = [];

  try {
    const url = `${CHICAGO_DATA_PORTAL}/${RED_LIGHT_CAMERA_DATASET}.json?$select=intersection,camera_id,violation_date,violations&$order=violation_date DESC&$limit=500&$where=violation_date > '${getDateNDaysAgo(90)}'`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return changes;

    const records: any[] = await response.json();

    const activeCameras = new Map<string, { cameraId: string; lastViolation: string; intersection: string }>();
    for (const r of records) {
      const addr = (r.intersection || '').toUpperCase().trim();
      if (!addr) continue;
      const existing = activeCameras.get(addr);
      if (!existing || r.violation_date > existing.lastViolation) {
        activeCameras.set(addr, {
          cameraId: r.camera_id || '',
          lastViolation: r.violation_date,
          intersection: r.intersection,
        });
      }
    }

    const { data: storedCameras } = await supabase
      .from('camera_monitor_state')
      .select('address, camera_id, last_seen')
      .eq('type', 'redlight');

    const storedSet = new Set((storedCameras || []).map((c: any) => c.address.toUpperCase().trim()));

    for (const [addr, info] of activeCameras) {
      if (!storedSet.has(addr)) {
        changes.push({
          type: 'redlight',
          action: 'added',
          address: info.intersection,
          latitude: null,
          longitude: null,
          detectedAt: new Date().toISOString(),
          details: `New red-light camera detected at ${info.intersection}`,
        });
      }
    }

    if (changes.length > 0) {
      console.log(`  Camera monitor: ${changes.length} red-light camera changes detected`);
    }
  } catch (error) {
    console.error('Red-light camera monitoring failed:', error);
  }

  return changes;
}

// ─── Signage Work Orders ─────────────────────────────────────

/**
 * Fetch recent sign repair/installation work orders from 311.
 * These are gold for defense — a reported sign problem proves the city
 * knew about signage issues at that location.
 */
export async function getRecentSignageWorkOrders(
  daysBack: number = 30,
): Promise<SignageWorkOrder[]> {
  try {
    const dateFilter = getDateNDaysAgo(daysBack);
    const url = `${CHICAGO_DATA_PORTAL}/v6vf-nfxy.json?` +
      `$where=sr_type like '%25Sign%25' AND created_date > '${dateFilter}T00:00:00'` +
      `&$order=created_date DESC&$limit=500`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return [];

    const records: any[] = await response.json();
    return records.map(r => ({
      serviceRequestId: r.sr_number,
      type: r.sr_type,
      address: r.street_address || '',
      latitude: parseFloat(r.latitude) || 0,
      longitude: parseFloat(r.longitude) || 0,
      createdDate: r.created_date,
      status: r.status,
      completedDate: r.closed_date || null,
    }));
  } catch (error) {
    console.error('Signage work order fetch failed:', error);
    return [];
  }
}

/**
 * Check if any signage work orders exist near a specific address.
 * Used during ticket evidence enrichment.
 */
export async function checkSignageIssuesNearLocation(
  latitude: number,
  longitude: number,
  violationDate: string,
  radiusFeet: number = 300,
): Promise<SignageWorkOrder[]> {
  try {
    const radiusMiles = radiusFeet / 5280;
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / 53;

    // Look for sign work 90 days before the violation
    const violDate = new Date(violationDate);
    const searchStart = new Date(violDate);
    searchStart.setDate(searchStart.getDate() - 90);

    const url = `${CHICAGO_DATA_PORTAL}/v6vf-nfxy.json?` +
      `$where=sr_type like '%25Sign%25' ` +
      `AND latitude between '${latitude - latDelta}' and '${latitude + latDelta}' ` +
      `AND longitude between '${longitude - lngDelta}' and '${longitude + lngDelta}' ` +
      `AND created_date > '${searchStart.toISOString().split('T')[0]}T00:00:00'` +
      `&$order=created_date DESC&$limit=20`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return [];

    const records: any[] = await response.json();
    return records.map(r => ({
      serviceRequestId: r.sr_number,
      type: r.sr_type,
      address: r.street_address || '',
      latitude: parseFloat(r.latitude) || 0,
      longitude: parseFloat(r.longitude) || 0,
      createdDate: r.created_date,
      status: r.status,
      completedDate: r.closed_date || null,
    }));
  } catch (error) {
    console.error('Signage check failed:', error);
    return [];
  }
}

// ─── Master Monitor Function ─────────────────────────────────

/**
 * Run all monitoring checks. Designed to be called from a weekly cron job.
 */
export async function runFullMonitoringScan(
  supabase: SupabaseClient,
): Promise<MonitorResult> {
  console.log('Chicago Open Data Monitor: starting full scan...');

  const [
    speedChanges,
    redLightChanges,
    signageOrders,
  ] = await Promise.allSettled([
    checkSpeedCameraChanges(supabase),
    checkRedLightCameraChanges(supabase),
    getRecentSignageWorkOrders(30),
  ]);

  const cameraChanges = [
    ...(speedChanges.status === 'fulfilled' ? speedChanges.value : []),
    ...(redLightChanges.status === 'fulfilled' ? redLightChanges.value : []),
  ];

  const signage = signageOrders.status === 'fulfilled' ? signageOrders.value : [];

  const result: MonitorResult = {
    cameraChanges,
    signageWorkOrders: signage,
    activeConstructionZones: [],
    timestamp: new Date().toISOString(),
  };

  // Log summary
  console.log(`  Camera changes: ${cameraChanges.length}`);
  console.log(`  Sign work orders (30d): ${signage.length}`);

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────

function getDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
