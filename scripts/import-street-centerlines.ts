/**
 * Import comprehensive Chicago street centerline geometry into Supabase.
 *
 * Sources:
 *   1. City of Chicago Open Data (GitHub GeoJSON) — ~56K segments covering all streets
 *   2. OpenStreetMap Overpass API — fills gaps for residential streets not in city data
 *
 * This gives snap_to_nearest_street() complete coverage of every Chicago street,
 * fixing the bug where residential streets (Wolcott, Hermitage, etc.) were invisible
 * because only ~125 major snow route arterials had geometry.
 *
 * Usage:
 *   npx ts-node scripts/import-street-centerlines.ts
 *
 * The script is idempotent — it truncates and re-imports on each run.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CHICAGO_GEOJSON_URL =
  'https://raw.githubusercontent.com/Chicago/osd-street-center-line/master/data/Transportation.geojson';

// Chicago bounding box for OSM query
const CHICAGO_BBOX = { south: 41.64, west: -87.94, north: 42.02, east: -87.52 };

// Batch size for Supabase inserts
const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set. Source .env.local first.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------------
// Chicago GeoJSON import
// ---------------------------------------------------------------------------

interface ChicagoFeature {
  type: 'Feature';
  properties: {
    PRE_DIR?: string;
    STREET_NAM?: string;
    STREET_TYP?: string;
    CLASS?: string;
    EWNS_DIR?: string;
    [key: string]: any;
  };
  geometry: {
    type: 'LineString' | 'MultiLineString';
    coordinates: number[][] | number[][][];
  };
}

function buildStreetName(props: ChicagoFeature['properties']): string {
  const parts: string[] = [];
  if (props.PRE_DIR) parts.push(props.PRE_DIR.trim());
  if (props.STREET_NAM) parts.push(props.STREET_NAM.trim());
  if (props.STREET_TYP) parts.push(props.STREET_TYP.trim());
  return parts.join(' ').toUpperCase();
}

function coordsToWKT(geometry: ChicagoFeature['geometry']): string | null {
  let coords: number[][];

  if (geometry.type === 'LineString') {
    coords = geometry.coordinates as number[][];
  } else if (geometry.type === 'MultiLineString') {
    // Use first line of multi
    const multi = geometry.coordinates as number[][][];
    if (!multi.length || !multi[0].length) return null;
    coords = multi[0];
  } else {
    return null;
  }

  if (coords.length < 2) return null;

  const points = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `SRID=4326;LINESTRING(${points})`;
}

async function downloadAndParseChicagoData(): Promise<ChicagoFeature[]> {
  console.log('Downloading Chicago street centerlines GeoJSON (83MB)...');

  const resp = await fetch(CHICAGO_GEOJSON_URL);
  if (!resp.ok) {
    throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);
  }

  console.log('Parsing JSON...');
  const text = await resp.text();
  const geojson = JSON.parse(text);

  console.log(`Parsed ${geojson.features.length} features from Chicago Open Data`);
  return geojson.features;
}

// ---------------------------------------------------------------------------
// OSM Overpass import (supplemental)
// ---------------------------------------------------------------------------

interface OSMElement {
  type: 'way';
  id: number;
  tags?: { name?: string; highway?: string };
  geometry?: Array<{ lat: number; lon: number }>;
}

async function downloadOSMStreets(): Promise<OSMElement[]> {
  console.log('Downloading OSM street data for Chicago...');

  // Query all named roads in Chicago (residential, tertiary, secondary, primary, trunk)
  const query = `[out:json][timeout:120];
    area["name"="Chicago"]["admin_level"="6"]->.chicago;
    way["highway"~"^(residential|tertiary|secondary|primary|trunk|living_street|unclassified)$"]["name"](area.chicago);
    out geom;`;

  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
  });

  if (!resp.ok) {
    console.warn(`OSM Overpass returned ${resp.status}. Skipping OSM supplement.`);
    return [];
  }

  const data = await resp.json();
  console.log(`Parsed ${data.elements.length} segments from OSM`);
  return data.elements;
}

function osmElementToWKT(element: OSMElement): string | null {
  if (!element.geometry || element.geometry.length < 2) return null;
  const points = element.geometry.map(g => `${g.lon} ${g.lat}`).join(', ');
  return `SRID=4326;LINESTRING(${points})`;
}

/**
 * Normalize an OSM street name to match Chicago convention.
 * OSM uses "North Wolcott Avenue", Chicago data uses "N WOLCOTT AVE".
 */
function normalizeOSMStreetName(name: string): string {
  const dirMap: Record<string, string> = {
    north: 'N', south: 'S', east: 'E', west: 'W',
  };
  const typeMap: Record<string, string> = {
    avenue: 'AVE', street: 'ST', boulevard: 'BLVD', drive: 'DR',
    road: 'RD', lane: 'LN', place: 'PL', court: 'CT',
    parkway: 'PKWY', terrace: 'TER', way: 'WAY', circle: 'CIR',
    highway: 'HWY', expressway: 'EXPY',
  };

  const parts = name.trim().split(/\s+/);
  const result: string[] = [];

  // Check for direction prefix
  if (parts.length > 1 && dirMap[parts[0].toLowerCase()]) {
    result.push(dirMap[parts[0].toLowerCase()]);
    parts.shift();
  }

  // Check for type suffix
  let streetType = '';
  if (parts.length > 1 && typeMap[parts[parts.length - 1].toLowerCase()]) {
    streetType = typeMap[parts[parts.length - 1].toLowerCase()];
    parts.pop();
  }

  // Middle parts are the street base name
  result.push(...parts.map(p => p.toUpperCase()));
  if (streetType) result.push(streetType);

  return result.join(' ');
}

function extractBaseName(streetName: string): string {
  const dirPrefixes = ['N ', 'S ', 'E ', 'W '];
  const typeSuffixes = [' AVE', ' ST', ' BLVD', ' DR', ' RD', ' LN', ' PL', ' CT',
    ' PKWY', ' TER', ' WAY', ' CIR', ' HWY', ' EXPY'];

  let name = streetName.toUpperCase();

  for (const d of dirPrefixes) {
    if (name.startsWith(d)) { name = name.slice(d.length); break; }
  }
  for (const t of typeSuffixes) {
    if (name.endsWith(t)) { name = name.slice(0, -t.length); break; }
  }

  return name.trim();
}

// ---------------------------------------------------------------------------
// Supabase insert
// ---------------------------------------------------------------------------

interface InsertRow {
  street_name: string;
  street_base_name: string;
  pre_dir: string | null;
  street_type: string | null;
  class: string | null;
  source: string;
  geom: string;  // EWKT
}

async function insertBatch(rows: InsertRow[]): Promise<number> {
  // Use raw SQL via RPC because Supabase JS client doesn't handle geometry EWKT well
  // We'll insert using the REST API with PostgREST
  // Actually, PostgREST supports geometry as EWKT strings if the column type is geometry

  const { error } = await supabase.from('street_centerlines').insert(rows);
  if (error) {
    console.error('Insert error:', error.message);
    // Try smaller batches
    if (rows.length > 50) {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const { error: e2 } = await supabase.from('street_centerlines').insert(chunk);
        if (e2) {
          console.error(`  Sub-batch ${i}-${i+50} failed:`, e2.message);
        } else {
          inserted += chunk.length;
        }
      }
      return inserted;
    }
    return 0;
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Street Centerlines Import ===\n');

  // Step 1: Clear existing data
  console.log('Step 1: Truncating street_centerlines table...');
  const { error: truncErr } = await supabase.from('street_centerlines').delete().gte('id', 0);
  if (truncErr) {
    console.warn('Truncate warning (table may not exist yet):', truncErr.message);
    console.log('If the table does not exist, run the migration first:');
    console.log('  npx supabase db push');
    process.exit(1);
  }

  // Step 2: Import Chicago Open Data
  console.log('\nStep 2: Importing Chicago Open Data...');
  const chicagoFeatures = await downloadAndParseChicagoData();

  let chicagoInserted = 0;
  let chicagoBatch: InsertRow[] = [];
  const chicagoStreetNames = new Set<string>();

  for (const feature of chicagoFeatures) {
    if (!feature.geometry || !feature.properties) continue;

    const streetName = buildStreetName(feature.properties);
    if (!streetName || streetName.length < 2) continue;

    const wkt = coordsToWKT(feature.geometry);
    if (!wkt) continue;

    chicagoStreetNames.add(streetName);

    chicagoBatch.push({
      street_name: streetName,
      street_base_name: feature.properties.STREET_NAM?.trim()?.toUpperCase() || extractBaseName(streetName),
      pre_dir: feature.properties.PRE_DIR?.trim() || null,
      street_type: feature.properties.STREET_TYP?.trim() || null,
      class: feature.properties.CLASS?.toString() || null,
      source: 'chicago_open_data',
      geom: wkt,
    });

    if (chicagoBatch.length >= BATCH_SIZE) {
      const n = await insertBatch(chicagoBatch);
      chicagoInserted += n;
      process.stdout.write(`\r  Inserted: ${chicagoInserted} / ${chicagoFeatures.length}`);
      chicagoBatch = [];
    }
  }

  // Flush remaining
  if (chicagoBatch.length > 0) {
    const n = await insertBatch(chicagoBatch);
    chicagoInserted += n;
  }

  console.log(`\n  Chicago data: ${chicagoInserted} segments inserted (${chicagoStreetNames.size} unique street names)`);

  // Step 3: Import OSM data to fill gaps
  console.log('\nStep 3: Importing OSM data for gap-filling...');
  let osmElements: OSMElement[] = [];
  try {
    osmElements = await downloadOSMStreets();
  } catch (e: any) {
    console.warn('OSM download failed (non-fatal):', e.message);
  }

  let osmInserted = 0;
  let osmSkipped = 0;
  let osmBatch: InsertRow[] = [];

  for (const element of osmElements) {
    if (!element.tags?.name || !element.geometry) continue;

    const normalizedName = normalizeOSMStreetName(element.tags.name);

    // Skip if Chicago data already has this street name
    if (chicagoStreetNames.has(normalizedName)) {
      osmSkipped++;
      continue;
    }

    const wkt = osmElementToWKT(element);
    if (!wkt) continue;

    osmBatch.push({
      street_name: normalizedName,
      street_base_name: extractBaseName(normalizedName),
      pre_dir: null,
      street_type: null,
      class: null,
      source: 'osm',
      geom: wkt,
    });

    if (osmBatch.length >= BATCH_SIZE) {
      const n = await insertBatch(osmBatch);
      osmInserted += n;
      process.stdout.write(`\r  OSM inserted: ${osmInserted} (skipped ${osmSkipped} duplicates)`);
      osmBatch = [];
    }
  }

  if (osmBatch.length > 0) {
    const n = await insertBatch(osmBatch);
    osmInserted += n;
  }

  console.log(`\n  OSM data: ${osmInserted} segments inserted, ${osmSkipped} skipped (already in Chicago data)`);

  // Step 4: Verify
  console.log('\nStep 4: Verification...');
  const { count } = await supabase.from('street_centerlines').select('*', { count: 'exact', head: true });
  console.log(`  Total rows in street_centerlines: ${count}`);

  // Check for Wolcott specifically
  const { data: wolcottData } = await supabase
    .from('street_centerlines')
    .select('street_name, source')
    .ilike('street_name', '%WOLCOTT%')
    .limit(5);
  console.log(`  Wolcott segments: ${wolcottData?.length || 0}`);
  if (wolcottData) {
    for (const r of wolcottData) {
      console.log(`    ${r.street_name} (${r.source})`);
    }
  }

  // Test snap_to_nearest_street with the Wolcott/Lawrence coords
  console.log('\nStep 5: Testing snap at Wolcott/Lawrence parking coords...');
  const { data: snapData, error: snapError } = await supabase.rpc('snap_to_nearest_street', {
    user_lat: 41.968826476664,
    user_lng: -87.67602554233498,
    search_radius_meters: 50,
  });

  if (snapError) {
    console.error('Snap test error:', snapError.message);
  } else {
    console.log('  Snap candidates:');
    for (const c of (snapData || [])) {
      console.log(`    ${c.street_name} — ${c.snap_distance_meters.toFixed(1)}m (${c.snap_source}) bearing=${c.street_bearing}`);
    }
  }

  console.log('\n=== Import Complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
