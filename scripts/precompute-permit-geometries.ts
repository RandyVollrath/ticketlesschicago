#!/usr/bin/env npx tsx
/**
 * Pre-compute permit zone geometries using OpenStreetMap street centerlines.
 *
 * For each permit zone record in parking_permit_zones, this script:
 *   1. Matches the street name to OSM ways (normalized name matching)
 *   2. Merges multiple OSM way segments into a single continuous polyline
 *   3. Uses Chicago's address grid to find WHERE on the polyline the
 *      permit zone's address range falls
 *   4. Extracts the sub-polyline for that address range
 *   5. Stores the resulting GeoJSON LineString in permit_zone_geometries
 *
 * Fallback: If no OSM match, uses street_geocache + grid math (straight line).
 *
 * Input:  /tmp/chicago_osm_streets.json (Overpass API export, ~60MB)
 * Output: permit_zone_geometries table rows
 *
 * Usage:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx tsx scripts/precompute-permit-geometries.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Chicago Grid Constants ───────────────────────────────────────────
const MADISON_LAT = 41.8819;   // Madison St = 0 N/S
const STATE_LNG   = -87.6278;  // State St = 0 E/W
const LAT_PER_ADDR = 0.01449 / 800; // ~0.00001811° per addr
const LNG_PER_ADDR = 0.01898 / 800; // ~0.00002373° per addr

// ─── Types ────────────────────────────────────────────────────────────
interface OsmWay {
  id: number;
  tags: { name: string; [key: string]: string };
  geometry: { lat: number; lon: number }[];
}

interface Point {
  lat: number;
  lng: number;
}

interface PermitZone {
  zone: number;
  street_direction: string;
  street_name: string;
  street_type: string | null;
  address_range_low: number;
  address_range_high: number;
  odd_even: string | null;
}

interface GeoRef {
  ref_lat: number;
  ref_lng: number;
  ref_addr_num: number;
  axis: string;
}

// ─── Name Normalization ───────────────────────────────────────────────

// OSM → abbreviated direction
const DIR_ABBREV: Record<string, string> = {
  North: 'N', South: 'S', East: 'E', West: 'W',
};

// OSM → abbreviated type
const TYPE_ABBREV: Record<string, string> = {
  Street: 'ST', Avenue: 'AVE', Boulevard: 'BLVD', Drive: 'DR',
  Road: 'RD', Place: 'PL', Court: 'CT', Terrace: 'TER',
  Parkway: 'PKWY', Lane: 'LN', Way: 'WAY', Circle: 'CIR',
  Square: 'SQ', Highway: 'HWY', Trail: 'TRL', Expressway: 'EXPY',
  Crossing: 'XING', Path: 'PATH', Row: 'ROW',
};

// Full word → abbreviated for special name tokens
const WORD_ABBREV: Record<string, string> = {
  Doctor: 'DR', Junior: 'JR', Senior: 'SR', Saint: 'ST',
  Martin: 'MARTIN', Luther: 'LUTHER',
};

/**
 * OSM names that don't match the DB format directly.
 * Maps: parsed OSM key → DB-compatible alternate key(s).
 * These are manually curated for known mismatches.
 */
const NAME_ALIASES: Record<string, string[]> = {
  // OSM renamed Lake Shore Drive in 2021 to honor DuSable
  'JEAN BAPTISTE POINT DUSABLE LAKE SHORE': ['LAKE SHORE'],
  // "King Drive" (short form in OSM) vs "DR MARTIN LUTHER KING JR" (DB full form)
  'KING': ['DR MARTIN LUTHER KING JR'],
  // OSM uses "Doctor Martin Luther King Junior" (full) → DB has "DR MARTIN LUTHER KING JR"
  'DR MARTIN LUTHER KING JR': ['DR MARTIN LUTHER KING JR'],
  // LaSalle (no space in OSM) vs LA SALLE (with space in DB)
  'LASALLE': ['LA SALLE'],
  // Broadway has no type in OSM
  'BROADWAY': ['BROADWAY'],
};

/**
 * Parse an OSM street name like "North Elston Avenue" into:
 *   { dir: 'N', name: 'ELSTON', type: 'AVE' }
 *
 * Handles:
 *  - Full direction prefix → abbreviated
 *  - Trailing type word → abbreviated
 *  - "South Doctor Martin Luther King Junior Drive" → dir=S, name="DR MARTIN LUTHER KING JR", type=DR
 *  - "100th Street" (no direction) → dir='', name='100TH', type='ST'
 */
function parseOsmName(osmName: string): { dir: string; name: string; type: string } {
  const parts = osmName.trim().split(/\s+/);
  if (parts.length === 0) return { dir: '', name: '', type: '' };

  // Extract direction prefix
  let dir = '';
  if (parts.length > 1 && DIR_ABBREV[parts[0]]) {
    dir = DIR_ABBREV[parts.shift()!];
  }

  // Extract trailing type
  let type = '';
  if (parts.length > 1) {
    const lastWord = parts[parts.length - 1];
    if (TYPE_ABBREV[lastWord]) {
      type = TYPE_ABBREV[lastWord];
      parts.pop();
    }
  }

  // Remaining parts = street name. Abbreviate known words, uppercase the rest.
  const nameParts = parts.map(p => {
    const abbrev = WORD_ABBREV[p];
    return abbrev || p.toUpperCase();
  });

  return { dir, name: nameParts.join(' '), type };
}

/**
 * Build all lookup keys for a DB permit zone record so we can match against
 * the OSM index. Returns multiple candidate keys to handle naming variants.
 */
function buildLookupKeys(dir: string, name: string, type: string | null): string[] {
  const keys: string[] = [];
  const t = type || '';

  // Primary key
  keys.push(`${dir}|${name}|${t}`);

  // Numbered streets in OSM often have no direction prefix
  // DB: dir=E, name=100TH, type=ST → OSM: "100th Street" → parsed: dir='', name='100TH', type='ST'
  if (/^\d/.test(name)) {
    keys.push(`|${name}|${t}`);
  }

  // "LA SALLE" vs "LASALLE"
  if (name.includes(' ')) {
    keys.push(`${dir}|${name.replace(/\s+/g, '')}|${t}`);
  }
  if (/[A-Z][a-z]/.test(name) === false && name.length > 5) {
    // Try inserting space: "LASALLE" → "LA SALLE"
    // This is too ambiguous to do generically — we handle it in fuzzy matching
  }

  return keys;
}

// ─── Geometry Utilities ───────────────────────────────────────────────

/** Haversine distance in meters */
function haversine(p1: Point, p2: Point): number {
  const R = 6371000;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Linear interpolation between two points at fraction t */
function lerp(p1: Point, p2: Point, t: number): Point {
  return {
    lat: p1.lat + (p2.lat - p1.lat) * t,
    lng: p1.lng + (p2.lng - p1.lng) * t,
  };
}

/** Convert address number to target lat/lng using Chicago grid */
function addrToGridCoord(addrNum: number, dir: string): { targetLat?: number; targetLng?: number } {
  if (dir === 'N' || dir === 'S') {
    const sign = dir === 'N' ? 1 : -1;
    return { targetLat: MADISON_LAT + sign * addrNum * LAT_PER_ADDR };
  } else {
    const sign = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
    return { targetLng: STATE_LNG + sign * addrNum * LNG_PER_ADDR };
  }
}

/**
 * Given a polyline and a target value along one axis (lat or lng),
 * find the point on the polyline where that axis value is crossed.
 * Returns the interpolated point, or null if no crossing found.
 */
function findCrossingPoint(
  polyline: Point[],
  axis: 'lat' | 'lng',
  target: number,
): { point: Point; segIndex: number; t: number } | null {
  for (let i = 0; i < polyline.length - 1; i++) {
    const v1 = polyline[i][axis];
    const v2 = polyline[i + 1][axis];

    // Check if target is between v1 and v2 (inclusive of endpoints)
    if ((v1 <= target && target <= v2) || (v2 <= target && target <= v1)) {
      const range = v2 - v1;
      if (Math.abs(range) < 1e-10) {
        // Segment is essentially flat on this axis — use midpoint
        return { point: lerp(polyline[i], polyline[i + 1], 0.5), segIndex: i, t: 0.5 };
      }
      const t = (target - v1) / range;
      return { point: lerp(polyline[i], polyline[i + 1], t), segIndex: i, t };
    }
  }
  return null;
}

/**
 * Extract a sub-polyline between two target values along an axis.
 * The sub-polyline includes all original points between the two crossings,
 * plus interpolated start/end points.
 */
function extractSubPolyline(
  polyline: Point[],
  axis: 'lat' | 'lng',
  targetLow: number,
  targetHigh: number,
): Point[] | null {
  // Determine which direction the polyline goes along this axis
  // It might go from high to low, so we need to handle both cases
  const start = Math.min(targetLow, targetHigh);
  const end = Math.max(targetLow, targetHigh);

  const crossLow = findCrossingPoint(polyline, axis, start);
  const crossHigh = findCrossingPoint(polyline, axis, end);

  if (!crossLow && !crossHigh) {
    // Neither endpoint intersects the polyline — check if polyline is entirely within range
    const axisValues = polyline.map(p => p[axis]);
    const minVal = Math.min(...axisValues);
    const maxVal = Math.max(...axisValues);
    if (minVal >= start && maxVal <= end) {
      // Entire polyline is within the range — return it all
      return [...polyline];
    }
    return null;
  }

  // Build sub-polyline
  const result: Point[] = [];

  if (crossLow && crossHigh) {
    // Both endpoints found
    const lowIdx = crossLow.segIndex;
    const highIdx = crossHigh.segIndex;

    if (lowIdx <= highIdx) {
      result.push(crossLow.point);
      for (let i = lowIdx + 1; i <= highIdx; i++) {
        result.push(polyline[i]);
      }
      result.push(crossHigh.point);
    } else {
      // Polyline goes in reverse direction
      result.push(crossHigh.point);
      for (let i = highIdx + 1; i <= lowIdx; i++) {
        result.push(polyline[i]);
      }
      result.push(crossLow.point);
    }
  } else if (crossLow) {
    // Only low found — extend to end of polyline
    result.push(crossLow.point);
    for (let i = crossLow.segIndex + 1; i < polyline.length; i++) {
      result.push(polyline[i]);
    }
  } else if (crossHigh) {
    // Only high found — extend from start
    for (let i = 0; i <= crossHigh.segIndex; i++) {
      result.push(polyline[i]);
    }
    result.push(crossHigh.point);
  }

  // Filter out degenerate results (single point or empty)
  if (result.length < 2) return null;

  return result;
}

interface MergedChain {
  points: Point[];
  /** Indices into `points` that are real intersection junctions (where OSM way segments meet) */
  junctions: Set<number>;
}

/**
 * Merge multiple OSM way segments into continuous polylines.
 * OSM splits long streets into many segments. We need to join segments
 * that share endpoints into longer chains.
 *
 * Returns an array of merged chains, each with:
 *  - points: the polyline
 *  - junctions: indices of points that are real street intersections
 *    (where original OSM way segments were split)
 *
 * Junction points are key for accuracy: OSM splits ways at intersections,
 * so these points represent the real-world coordinates of cross-streets.
 */
function mergeWaySegments(ways: OsmWay[]): MergedChain[] {
  if (ways.length === 0) return [];
  if (ways.length === 1) {
    const pts = ways[0].geometry.map(g => ({ lat: g.lat, lng: g.lon }));
    // First and last points of a single way are intersection endpoints
    return [{ points: pts, junctions: new Set([0, pts.length - 1]) }];
  }

  // Convert each way to a polyline with a hash for start/end points
  const segments = ways.map(w => ({
    id: w.id,
    points: w.geometry.map(g => ({ lat: g.lat, lng: g.lon })),
  }));

  // Build adjacency via endpoint proximity (within ~5m)
  const SNAP_DIST = 5; // meters

  function ptKey(p: Point): string {
    // Round to ~1m precision for snapping
    return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  }

  // Index all segment endpoints
  const endpointIndex = new Map<string, { segIdx: number; end: 'start' | 'end' }[]>();
  for (let i = 0; i < segments.length; i++) {
    const pts = segments[i].points;
    const startKey = ptKey(pts[0]);
    const endKey = ptKey(pts[pts.length - 1]);

    if (!endpointIndex.has(startKey)) endpointIndex.set(startKey, []);
    endpointIndex.get(startKey)!.push({ segIdx: i, end: 'start' });

    if (!endpointIndex.has(endKey)) endpointIndex.set(endKey, []);
    endpointIndex.get(endKey)!.push({ segIdx: i, end: 'end' });
  }

  // Build chains by following connected segments, tracking junction points
  const used = new Set<number>();
  const chains: MergedChain[] = [];

  for (let startSeg = 0; startSeg < segments.length; startSeg++) {
    if (used.has(startSeg)) continue;

    // Start a new chain
    let chain = [...segments[startSeg].points];
    // Track junction indices: start and end of first segment are junctions
    let junctions = new Set<number>([0, chain.length - 1]);
    used.add(startSeg);

    // Extend chain forward (from end)
    let extended = true;
    while (extended) {
      extended = false;
      const endKey = ptKey(chain[chain.length - 1]);
      const neighbors = endpointIndex.get(endKey) || [];
      for (const n of neighbors) {
        if (used.has(n.segIdx)) continue;
        used.add(n.segIdx);
        const seg = segments[n.segIdx].points;
        if (n.end === 'start') {
          // Segment starts where our chain ends — append (skip first point, it's a duplicate)
          // The junction is at current chain end (already tracked) and at the new segment's end
          const newEndIdx = chain.length - 1 + seg.length - 1;
          chain.push(...seg.slice(1));
          junctions.add(newEndIdx);
        } else {
          // Segment ends where our chain ends — append reversed (skip first point)
          const newEndIdx = chain.length - 1 + seg.length - 1;
          chain.push(...seg.slice(0, -1).reverse());
          junctions.add(newEndIdx);
        }
        extended = true;
        break; // restart from the new end
      }
    }

    // Extend chain backward (from start)
    extended = true;
    while (extended) {
      extended = false;
      const startKey = ptKey(chain[0]);
      const neighbors = endpointIndex.get(startKey) || [];
      for (const n of neighbors) {
        if (used.has(n.segIdx)) continue;
        used.add(n.segIdx);
        const seg = segments[n.segIdx].points;
        const prependCount = seg.length - 1; // points added to front
        if (n.end === 'end') {
          // Segment ends where our chain starts — prepend
          chain = [...seg.slice(0, -1), ...chain];
        } else {
          // Segment starts where our chain starts — prepend reversed
          chain = [...seg.slice(1).reverse(), ...chain];
        }
        // Shift all existing junction indices by prependCount
        const shifted = new Set<number>();
        for (const j of junctions) shifted.add(j + prependCount);
        shifted.add(0); // new start of chain is a junction
        junctions = shifted;
        extended = true;
        break;
      }
    }

    chains.push({ points: chain, junctions });
  }

  return chains;
}

/**
 * Reverse grid math: estimate what address number a lat or lng corresponds to.
 */
function coordToAddr(coord: number, axis: 'lat' | 'lng', dir: string): number {
  if (axis === 'lat') {
    const sign = dir === 'N' ? 1 : -1;
    return sign * (coord - MADISON_LAT) / LAT_PER_ADDR;
  } else {
    const sign = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
    return sign === 0 ? 0 : (coord - STATE_LNG) / (sign * LNG_PER_ADDR);
  }
}

/**
 * Round an address to the nearest block boundary (multiple of 100).
 * In Chicago, cross-streets occur at multiples of 100.
 *
 * E.g., addr 2397 → 2400, addr 2315 → 2300, addr 2250 → 2200 or 2300.
 */
function nearestBlockBoundary(addr: number): number {
  return Math.round(addr / 100) * 100;
}

/**
 * Given a merged chain with junction points, build a calibration table that maps
 * junction indices to their real-world address estimates, snapped to block boundaries.
 *
 * This lets us use real intersection coordinates instead of relying on grid math
 * to determine where address ranges fall on the polyline.
 *
 * Returns sorted array of { index, addr, coord } calibration points.
 */
function buildCalibrationTable(
  chain: MergedChain,
  axis: 'lat' | 'lng',
  dir: string,
): { index: number; addr: number; coord: number }[] {
  const calibPoints: { index: number; addr: number; coord: number }[] = [];

  // Sort junction indices
  const sortedJunctions = [...chain.junctions].sort((a, b) => a - b);

  for (const idx of sortedJunctions) {
    const pt = chain.points[idx];
    const coord = pt[axis];
    const rawAddr = coordToAddr(coord, axis, dir);

    // Only include junctions with plausible addresses (positive, within Chicago range)
    if (rawAddr > 0 && rawAddr < 15000) {
      const snappedAddr = nearestBlockBoundary(rawAddr);
      calibPoints.push({ index: idx, addr: snappedAddr, coord });
    }
  }

  // Sort by index (polyline order)
  calibPoints.sort((a, b) => a.index - b.index);

  // Remove duplicates with same snapped address (keep the one closest to the expected coord)
  const deduped: typeof calibPoints = [];
  for (const cp of calibPoints) {
    const existing = deduped.find(d => d.addr === cp.addr);
    if (!existing) {
      deduped.push(cp);
    }
  }

  return deduped;
}

/**
 * Given calibration points and a target address, find the point on the polyline
 * by interpolating between the two nearest calibration anchors.
 *
 * This is MUCH more accurate than raw grid math because it uses real intersection
 * coordinates as anchors (from OSM way segment boundaries).
 */
function calibratedAddrToIndex(
  calibPoints: { index: number; addr: number; coord: number }[],
  targetAddr: number,
  chain: Point[],
  axis: 'lat' | 'lng',
  dir: string,
): { point: Point; segIndex: number } | null {
  if (calibPoints.length === 0) return null;

  // Sort calibration points by address
  const sorted = [...calibPoints].sort((a, b) => a.addr - b.addr);

  // Find bracketing calibration points
  let lower = sorted[0];
  let upper = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].addr <= targetAddr && sorted[i + 1].addr >= targetAddr) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }

  // If target is outside calibration range, use grid math as fallback
  if (targetAddr < lower.addr - 200 || targetAddr > upper.addr + 200) {
    return null; // outside range, fall back to grid math
  }

  // Clamp to the calibrated range
  if (targetAddr <= lower.addr) {
    return { point: chain[lower.index], segIndex: Math.max(0, lower.index - 1) };
  }
  if (targetAddr >= upper.addr) {
    return { point: chain[upper.index], segIndex: Math.min(chain.length - 2, upper.index) };
  }

  // Interpolate between lower and upper calibration points
  const addrFraction = (targetAddr - lower.addr) / (upper.addr - lower.addr);

  // Walk the polyline from lower.index to upper.index, measuring cumulative distance
  const lowerIdx = Math.min(lower.index, upper.index);
  const upperIdx = Math.max(lower.index, upper.index);

  let totalDist = 0;
  const segDists: number[] = [];
  for (let i = lowerIdx; i < upperIdx; i++) {
    const d = haversine(chain[i], chain[i + 1]);
    segDists.push(d);
    totalDist += d;
  }

  if (totalDist < 0.1) {
    return { point: chain[lowerIdx], segIndex: lowerIdx };
  }

  // Walk to the target fraction of total distance
  const targetDist = addrFraction * totalDist;
  let cumDist = 0;

  for (let i = 0; i < segDists.length; i++) {
    if (cumDist + segDists[i] >= targetDist) {
      const segFraction = (targetDist - cumDist) / segDists[i];
      const pt = lerp(chain[lowerIdx + i], chain[lowerIdx + i + 1], segFraction);
      return { point: pt, segIndex: lowerIdx + i };
    }
    cumDist += segDists[i];
  }

  return { point: chain[upperIdx], segIndex: upperIdx - 1 };
}

/**
 * Given merged polyline chains for a street and the permit zone's address range,
 * extract the best matching sub-polyline.
 *
 * Strategy: Use junction-calibrated extraction first (real intersection snapping),
 * fall back to pure grid math if calibration data is insufficient.
 */
function findPermitZoneGeometry(
  chains: MergedChain[],
  dir: string,
  addrLow: number,
  addrHigh: number,
): { geometry: Point[]; source: string } | null {
  const isNS = (dir === 'N' || dir === 'S');
  const axis: 'lat' | 'lng' = isNS ? 'lat' : 'lng';

  // Chicago address convention: X00-X98 means "from cross-street at X00 to cross-street at (X+1)00"
  // Round endpoint addresses to block boundaries for matching
  const addrLowBlock = Math.floor(addrLow / 100) * 100;
  const addrHighBlock = Math.ceil(addrHigh / 100) * 100;
  // If addrHigh ends at X98 or X99, it means "up to the next cross-street"
  const effectiveHighAddr = (addrHigh % 100 >= 98) ? addrHighBlock : addrHigh;
  const effectiveLowAddr = (addrLow % 100 <= 2) ? addrLowBlock : addrLow;

  // Try each chain — pick the one that gives the best result
  let bestResult: Point[] | null = null;
  let bestLength = 0;

  for (const chain of chains) {
    // Check if this chain overlaps the target range on the relevant axis (rough check)
    const axisValues = chain.points.map(p => p[axis]);
    const chainMin = Math.min(...axisValues);
    const chainMax = Math.max(...axisValues);

    // Quick grid-math target for overlap check
    const coordLow = isNS
      ? (MADISON_LAT + (dir === 'N' ? 1 : -1) * addrLow * LAT_PER_ADDR)
      : (STATE_LNG + (dir === 'E' ? 1 : dir === 'W' ? -1 : 0) * addrLow * LNG_PER_ADDR);
    const coordHigh = isNS
      ? (MADISON_LAT + (dir === 'N' ? 1 : -1) * addrHigh * LAT_PER_ADDR)
      : (STATE_LNG + (dir === 'E' ? 1 : dir === 'W' ? -1 : 0) * addrHigh * LNG_PER_ADDR);
    const targetLow = Math.min(coordLow, coordHigh);
    const targetHigh = Math.max(coordLow, coordHigh);

    if (chainMax < targetLow - 0.002 || chainMin > targetHigh + 0.002) continue;

    // ── Calibrated extraction (preferred) ──────────────────────────
    let sub: Point[] | null = null;

    if (chain.junctions.size >= 2) {
      const calibTable = buildCalibrationTable(chain, axis, dir);

      if (calibTable.length >= 2) {
        const startResult = calibratedAddrToIndex(calibTable, effectiveLowAddr, chain.points, axis, dir);
        const endResult = calibratedAddrToIndex(calibTable, effectiveHighAddr, chain.points, axis, dir);

        if (startResult && endResult) {
          const lowIdx = Math.min(startResult.segIndex, endResult.segIndex);
          const highIdx = Math.max(startResult.segIndex, endResult.segIndex);

          // Build sub-polyline from startResult.point through chain points to endResult.point
          const result: Point[] = [];
          const startPt = startResult.segIndex <= endResult.segIndex ? startResult : endResult;
          const endPt = startResult.segIndex <= endResult.segIndex ? endResult : startResult;

          result.push(startPt.point);
          for (let i = startPt.segIndex + 1; i <= endPt.segIndex; i++) {
            result.push(chain.points[i]);
          }
          result.push(endPt.point);

          if (result.length >= 2) {
            sub = result;
          }
        }
      }
    }

    // ── Grid-math fallback ─────────────────────────────────────────
    if (!sub) {
      sub = extractSubPolyline(chain.points, axis, targetLow, targetHigh);
    }

    if (sub && sub.length >= 2) {
      let len = 0;
      for (let i = 0; i < sub.length - 1; i++) {
        len += haversine(sub[i], sub[i + 1]);
      }
      if (len > bestLength) {
        bestLength = len;
        bestResult = sub;
      }
    }
  }

  if (bestResult) {
    return { geometry: bestResult, source: 'osm' };
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Pre-compute Permit Zone Geometries ===\n');

  // 1. Load OSM data
  console.log('Loading OSM street data...');
  const osmPath = '/tmp/chicago_osm_streets.json';
  if (!fs.existsSync(osmPath)) {
    console.error(`OSM data not found at ${osmPath}. Run Overpass download first.`);
    process.exit(1);
  }
  const osmData = JSON.parse(fs.readFileSync(osmPath, 'utf8'));
  const osmWays: OsmWay[] = osmData.elements.filter((e: any) => e.type === 'way' && e.tags?.name && e.geometry?.length >= 2);
  console.log(`  Loaded ${osmWays.length} OSM ways with geometry`);

  // 2. Build OSM lookup index: normalized key → [ways]
  console.log('Building OSM street name index...');
  const osmIndex = new Map<string, OsmWay[]>();

  function addToIndex(key: string, way: OsmWay) {
    if (!osmIndex.has(key)) osmIndex.set(key, []);
    osmIndex.get(key)!.push(way);
  }

  for (const way of osmWays) {
    const parsed = parseOsmName(way.tags.name);
    const key = `${parsed.dir}|${parsed.name}|${parsed.type}`;

    addToIndex(key, way);

    // Also register NAME_ALIASES: if OSM name matches an alias source,
    // index under the alias target(s) too
    const aliases = NAME_ALIASES[parsed.name];
    if (aliases) {
      for (const aliasName of aliases) {
        addToIndex(`${parsed.dir}|${aliasName}|${parsed.type}`, way);
      }
    }

    // For numbered streets: OSM may lack direction prefix
    // DB always has direction (E/W for numbered). Index without dir as fallback.
    if (/^\d/.test(parsed.name)) {
      addToIndex(`|${parsed.name}|${parsed.type}`, way);
    }
  }
  console.log(`  ${osmIndex.size} unique street name keys`);

  // 3. Load geocache fallback
  console.log('Loading street geocache fallback...');
  const { data: geocacheData } = await supabase
    .from('street_geocache')
    .select('street_direction, street_name, street_type, ref_lat, ref_lng, ref_addr_num, axis');

  const geocache = new Map<string, GeoRef>();
  for (const g of (geocacheData || [])) {
    const key = `${g.street_direction}|${g.street_name}|${g.street_type || ''}`;
    geocache.set(key, {
      ref_lat: g.ref_lat,
      ref_lng: g.ref_lng,
      ref_addr_num: g.ref_addr_num,
      axis: g.axis,
    });
  }
  console.log(`  ${geocache.size} geocache entries`);

  // 4. Fetch all permit zones (paginated)
  console.log('Fetching permit zones...');
  const zones: PermitZone[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('parking_permit_zones')
      .select('zone, street_direction, street_name, street_type, address_range_low, address_range_high, odd_even')
      .eq('status', 'ACTIVE')
      .range(from, from + PAGE_SIZE - 1);

    if (error) { console.error('DB error:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    zones.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  console.log(`  ${zones.length} active permit zones`);

  // 5. Clear existing geometries (full rebuild)
  console.log('Clearing existing permit_zone_geometries...');
  const { error: delErr } = await supabase.from('permit_zone_geometries').delete().gte('id', 0);
  if (delErr) {
    console.warn('  Delete warning (may be empty):', delErr.message);
    // Try alternative delete
    await supabase.from('permit_zone_geometries').delete().neq('id', -1);
  }

  // 6. Process each permit zone
  console.log('\nProcessing permit zones...\n');

  let osmMatched = 0;
  let geocacheFallback = 0;
  let unresolved = 0;
  let totalProcessed = 0;
  const batchSize = 100;
  let batch: any[] = [];
  const unresolvedStreets = new Set<string>();

  // Pre-merge chains per OSM key to avoid re-merging for each zone
  const chainCache = new Map<string, MergedChain[]>();

  function getChains(key: string): MergedChain[] | null {
    if (chainCache.has(key)) return chainCache.get(key)!;
    const ways = osmIndex.get(key);
    if (!ways || ways.length === 0) return null;
    const chains = mergeWaySegments(ways);
    chainCache.set(key, chains);
    return chains;
  }

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z.address_range_low || !z.address_range_high) {
      unresolved++;
      totalProcessed++;
      continue;
    }

    // Try to match OSM ways
    const keys = buildLookupKeys(z.street_direction, z.street_name, z.street_type);
    let result: { geometry: Point[]; source: string } | null = null;
    let matchedOsmKey: string | null = null;

    for (const key of keys) {
      const chains = getChains(key);
      if (chains && chains.length > 0) {
        result = findPermitZoneGeometry(chains, z.street_direction, z.address_range_low, z.address_range_high);
        if (result) {
          matchedOsmKey = key;
          break;
        }
      }
    }

    // Fuzzy fallback: try without type, try with spaces removed, etc.
    if (!result) {
      // Try without type suffix
      const noTypeKey = `${z.street_direction}|${z.street_name}|`;
      const noTypeChains = getChains(noTypeKey);
      if (noTypeChains) {
        result = findPermitZoneGeometry(noTypeChains, z.street_direction, z.address_range_low, z.address_range_high);
        if (result) matchedOsmKey = noTypeKey;
      }
    }

    if (!result) {
      // Try removing spaces in name (LA SALLE → LASALLE)
      const noSpaceName = z.street_name.replace(/\s+/g, '');
      if (noSpaceName !== z.street_name) {
        const nsKey = `${z.street_direction}|${noSpaceName}|${z.street_type || ''}`;
        const nsChains = getChains(nsKey);
        if (nsChains) {
          result = findPermitZoneGeometry(nsChains, z.street_direction, z.address_range_low, z.address_range_high);
          if (result) matchedOsmKey = nsKey;
        }
      }
    }

    if (!result) {
      // Try adding spaces (LASALLE → LA SALLE)
      const withSpaces = z.street_name.replace(/^(LA|MC|MAC|DE|DU|LE|VAN|VON)(\S)/i, '$1 $2');
      if (withSpaces !== z.street_name) {
        const wsKey = `${z.street_direction}|${withSpaces}|${z.street_type || ''}`;
        const wsChains = getChains(wsKey);
        if (wsChains) {
          result = findPermitZoneGeometry(wsChains, z.street_direction, z.address_range_low, z.address_range_high);
          if (result) matchedOsmKey = wsKey;
        }
      }
    }

    if (result) {
      osmMatched++;
      // Convert geometry to GeoJSON LineString
      const geojson = {
        type: 'LineString',
        coordinates: result.geometry.map(p => [p.lng, p.lat]),
      };

      batch.push({
        zone: z.zone,
        street_direction: z.street_direction,
        street_name: z.street_name,
        street_type: z.street_type,
        address_range_low: z.address_range_low,
        address_range_high: z.address_range_high,
        odd_even: z.odd_even,
        geometry: geojson,
        source: 'osm',
        properties: { osm_key: matchedOsmKey },
      });
    } else {
      // Geocache fallback
      const gcKey = `${z.street_direction}|${z.street_name}|${z.street_type || ''}`;
      const geo = geocache.get(gcKey);

      if (geo) {
        geocacheFallback++;
        const dir = z.street_direction;
        const addrLow = z.address_range_low;
        const addrHigh = z.address_range_high;
        let startLat: number, startLng: number, endLat: number, endLng: number;

        if (geo.axis === 'ns') {
          const lng = geo.ref_lng;
          const sign = dir === 'N' ? 1 : -1;
          startLat = MADISON_LAT + sign * addrLow * LAT_PER_ADDR;
          endLat = MADISON_LAT + sign * addrHigh * LAT_PER_ADDR;
          startLng = lng;
          endLng = lng;
        } else {
          const lat = geo.ref_lat;
          const sign = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
          startLng = STATE_LNG + sign * addrLow * LNG_PER_ADDR;
          endLng = STATE_LNG + sign * addrHigh * LNG_PER_ADDR;
          startLat = lat;
          endLat = lat;
        }

        const geojson = {
          type: 'LineString',
          coordinates: [[startLng, startLat], [endLng, endLat]],
        };

        batch.push({
          zone: z.zone,
          street_direction: z.street_direction,
          street_name: z.street_name,
          street_type: z.street_type,
          address_range_low: z.address_range_low,
          address_range_high: z.address_range_high,
          odd_even: z.odd_even,
          geometry: geojson,
          source: 'geocache',
          properties: {},
        });
      } else {
        unresolved++;
        unresolvedStreets.add(`${z.street_direction} ${z.street_name} ${z.street_type || ''} (zone ${z.zone})`);
      }
    }

    totalProcessed++;

    // Insert batch
    if (batch.length >= batchSize) {
      const { error: insertErr } = await supabase
        .from('permit_zone_geometries')
        .insert(batch);
      if (insertErr) {
        console.error(`  Batch insert error at ${totalProcessed}:`, insertErr.message);
        // Try one-by-one
        for (const item of batch) {
          const { error: singleErr } = await supabase
            .from('permit_zone_geometries')
            .insert(item);
          if (singleErr) {
            console.error(`  Single insert error for zone ${item.zone} ${item.street_direction} ${item.street_name}:`, singleErr.message);
          }
        }
      }
      batch = [];
    }

    // Progress
    if ((totalProcessed) % 500 === 0 || totalProcessed === zones.length) {
      const pct = (totalProcessed / zones.length * 100).toFixed(1);
      console.log(`  [${pct}%] ${totalProcessed}/${zones.length} — OSM: ${osmMatched}, Geocache: ${geocacheFallback}, Unresolved: ${unresolved}`);
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    const { error: insertErr } = await supabase
      .from('permit_zone_geometries')
      .insert(batch);
    if (insertErr) {
      console.error('  Final batch insert error:', insertErr.message);
      for (const item of batch) {
        const { error: singleErr } = await supabase
          .from('permit_zone_geometries')
          .insert(item);
        if (singleErr) {
          console.error(`  Single insert error for zone ${item.zone} ${item.street_direction} ${item.street_name}:`, singleErr.message);
        }
      }
    }
  }

  // Final summary
  console.log('\n=== Summary ===');
  console.log(`Total zones:       ${zones.length}`);
  console.log(`OSM matched:       ${osmMatched} (${(osmMatched / zones.length * 100).toFixed(1)}%)`);
  console.log(`Geocache fallback: ${geocacheFallback} (${(geocacheFallback / zones.length * 100).toFixed(1)}%)`);
  console.log(`Unresolved:        ${unresolved} (${(unresolved / zones.length * 100).toFixed(1)}%)`);
  console.log(`Chain cache size:  ${chainCache.size} merged street polylines`);

  if (unresolvedStreets.size > 0) {
    console.log(`\n--- Unresolved streets (${unresolvedStreets.size} unique) ---`);
    for (const s of [...unresolvedStreets].sort()) {
      console.log(`  ${s}`);
    }
  }

  // Verify DB count
  const { count } = await supabase
    .from('permit_zone_geometries')
    .select('*', { count: 'exact', head: true });
  console.log(`\nDB rows in permit_zone_geometries: ${count}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
