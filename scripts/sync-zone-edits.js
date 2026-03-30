#!/usr/bin/env node
/**
 * Sync zone edits from Supabase INTO the static GeoJSON file.
 *
 * Run this BEFORE every deploy to bake manual edits into the static file.
 * This ensures edits survive deploys and aren't overwritten.
 *
 * Usage: node scripts/sync-zone-edits.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const geojsonPath = path.join(__dirname, '..', 'public', 'data', 'street-cleaning-zones-2026.geojson');
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

  console.log('Loading zone geometries from Supabase...');

  // Get all zone geometries from Supabase
  let allRows = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('street_cleaning_schedule')
      .select('ward_section, geom')
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    page++;
  }

  // Dedupe by ward_section
  const dbGeom = new Map();
  for (const row of allRows) {
    if (!dbGeom.has(row.ward_section) && row.geom) {
      dbGeom.set(row.ward_section, row.geom);
    }
  }

  // Compare and update static file with any Supabase edits
  let synced = 0;
  for (const feature of geojson.features) {
    const ws = `${feature.properties.ward}-${feature.properties.section}`;
    const dbG = dbGeom.get(ws);
    if (!dbG) continue;

    // Compare first coordinate as fingerprint
    const stFirst = JSON.stringify(feature.geometry?.coordinates?.[0]?.[0]?.[0]);
    const dbFirst = JSON.stringify(dbG.coordinates?.[0]?.[0]?.[0]);

    if (stFirst !== dbFirst) {
      // Supabase has a different geometry — this is a manual edit
      feature.geometry = dbG;
      feature.properties.source = 'manual_edit';
      synced++;
      console.log(`  Synced ${ws} (manual edit from Supabase)`);
    }
  }

  if (synced > 0) {
    fs.writeFileSync(geojsonPath, JSON.stringify(geojson));
    console.log(`\nSynced ${synced} manual edits into static GeoJSON file.`);
  } else {
    console.log('\nNo new edits to sync. Static file is up to date.');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
