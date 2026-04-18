/**
 * Import Chicago Building Footprints with addresses into Supabase.
 *
 * Source: Chicago Open Data Portal dataset `syp8-uezg` (~820K rows).
 * Each row is a building with a MultiPolygon footprint + label_hous (the
 * display house number) + street fields.
 *
 * We reduce each building to its centroid + house_number + full_street_name
 * for cheap spatial-nearest-neighbor queries during parking checks.
 *
 * Usage:
 *   npx ts-node scripts/import-chicago-buildings.ts
 *
 * Idempotent — truncates chicago_building_addresses before re-importing.
 * Takes ~15-20 minutes (~820K rows, batched 500 at a time via SODA API).
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import * as path from 'path';

// ES-module-safe __dirname equivalent. ts-node runs this file as ESM so
// CommonJS __dirname isn't defined; derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load .env.local quietly so dotenv's stdout tip (non-ASCII chars) doesn't
// leak into anything that captures process stdout.
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

const SUPABASE_URL = 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SOURCE = 'https://data.cityofchicago.org/resource/syp8-uezg.json';
const PAGE = 1000; // max rows per Socrata SODA request
const BATCH_SIZE = 500;

interface BuildingRow {
  bldg_id: string | null;
  house_number: number;
  pre_dir: string | null;
  street_name: string | null;
  street_type: string | null;
  full_street_name: string | null;
  point: string; // EWKT Point
}

interface SourceRow {
  bldg_id?: string;
  label_hous?: string;
  pre_dir1?: string;
  st_name1?: string;
  st_type1?: string;
  the_geom?: {
    type: 'MultiPolygon' | 'Polygon';
    coordinates: any;
  };
}

function centroidOfPolygon(coords: number[][]): [number, number] {
  // Simple centroid: average of vertices (not area-weighted, but polygons
  // are small so it's within a meter of the true centroid).
  let sumLng = 0, sumLat = 0, n = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
    n += 1;
  }
  return [sumLng / n, sumLat / n];
}

function centroidOfGeometry(geom: SourceRow['the_geom']): [number, number] | null {
  if (!geom) return null;
  if (geom.type === 'MultiPolygon') {
    const ring = geom.coordinates?.[0]?.[0];
    if (!ring || ring.length < 3) return null;
    return centroidOfPolygon(ring);
  }
  if (geom.type === 'Polygon') {
    const ring = geom.coordinates?.[0];
    if (!ring || ring.length < 3) return null;
    return centroidOfPolygon(ring);
  }
  return null;
}

function buildFullStreet(preDir: string | null, name: string | null, type: string | null): string | null {
  const parts: string[] = [];
  if (preDir) parts.push(preDir.trim());
  if (name) parts.push(name.trim());
  if (type) parts.push(type.trim());
  const s = parts.filter(Boolean).join(' ').toUpperCase();
  return s || null;
}

function toRow(src: SourceRow): BuildingRow | null {
  const houseRaw = src.label_hous;
  const n = houseRaw ? parseInt(houseRaw, 10) : 0;
  if (!n || n <= 0) return null; // skip zero/missing house numbers

  const preDir = (src.pre_dir1 || '').trim() || null;
  const streetName = (src.st_name1 || '').trim() || null;
  const streetType = (src.st_type1 || '').trim() || null;
  if (!streetName) return null; // skip unaddressed buildings

  const centroid = centroidOfGeometry(src.the_geom);
  if (!centroid) return null;
  const [lng, lat] = centroid;

  return {
    bldg_id: src.bldg_id || null,
    house_number: n,
    pre_dir: preDir,
    street_name: streetName,
    street_type: streetType,
    full_street_name: buildFullStreet(preDir, streetName, streetType),
    point: `SRID=4326;POINT(${lng} ${lat})`,
  };
}

async function fetchPage(offset: number): Promise<SourceRow[]> {
  const url = `${SOURCE}?$limit=${PAGE}&$offset=${offset}&$select=bldg_id,label_hous,pre_dir1,st_name1,st_type1,the_geom`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`SODA fetch failed: ${resp.status} ${resp.statusText}`);
  return resp.json();
}

async function insertBatch(rows: BuildingRow[]): Promise<number> {
  const { error } = await supabase.from('chicago_building_addresses').insert(rows);
  if (error) {
    console.error('\nInsert error:', error.message);
    if (rows.length > 50) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const { error: e2 } = await supabase.from('chicago_building_addresses').insert(chunk);
        if (!e2) n += chunk.length;
      }
      return n;
    }
    return 0;
  }
  return rows.length;
}

(async () => {
  console.log('=== Chicago Building Addresses Import ===\n');

  console.log('Step 1: Truncating chicago_building_addresses table...');
  const { error: truncErr } = await supabase.from('chicago_building_addresses').delete().gte('id', 0);
  if (truncErr) {
    console.warn('Truncate failed — check migration has been applied:', truncErr.message);
    process.exit(1);
  }

  console.log('Step 2: Streaming from Chicago SODA API...');
  let offset = 0;
  let totalInserted = 0;
  let batch: BuildingRow[] = [];
  let pageCount = 0;

  while (true) {
    const src = await fetchPage(offset);
    if (src.length === 0) break;
    pageCount += 1;

    for (const item of src) {
      const row = toRow(item);
      if (row) batch.push(row);
    }

    while (batch.length >= BATCH_SIZE) {
      const chunk = batch.splice(0, BATCH_SIZE);
      const n = await insertBatch(chunk);
      totalInserted += n;
      process.stdout.write(`\r  Pages: ${pageCount}  Inserted: ${totalInserted.toLocaleString()}`);
    }

    offset += src.length;
    if (src.length < PAGE) break; // final page
  }

  // Flush remaining
  if (batch.length > 0) {
    totalInserted += await insertBatch(batch);
  }

  console.log(`\n\nStep 3: Verification...`);
  const { count } = await supabase.from('chicago_building_addresses').select('id', { count: 'exact', head: true });
  console.log(`  Total rows: ${count?.toLocaleString()}`);

  const { data: test } = await supabase.rpc('nearest_address_point', {
    user_lat: 41.968613, user_lng: -87.676053, search_radius_meters: 25,
    expected_street: 'N WOLCOTT AVE',
  });
  if (test && test.length > 0) {
    console.log(`  Test lookup @ Randy's Wolcott spot: ${test[0].house_number} ${test[0].full_street_name} (${test[0].distance_meters.toFixed(1)}m away)`);
  } else {
    console.log(`  Test lookup: no building within 25m on N Wolcott Ave`);
  }

  console.log('\n=== Import Complete ===');
})().catch((e) => {
  console.error('\nIMPORT FAILED:', e);
  process.exit(1);
});
