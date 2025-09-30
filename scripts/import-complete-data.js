#!/usr/bin/env node
/**
 * Imports complete street cleaning data (geometry + correct dates) to both databases
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const csv = require('csv-parser');

// Both databases
const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function importComplete() {
  console.log('🚀 Importing complete data to both databases\n');

  // Step 1: Load geometry data
  console.log('📂 Loading geometry CSV...');
  const geometryMap = new Map();

  await new Promise((resolve, reject) => {
    fs.createReadStream('/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv')
      .pipe(csv())
      .on('data', (row) => {
        const key = `${row.ward}-${row.section}`;
        if (!geometryMap.has(key)) {
          geometryMap.set(key, row);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Loaded geometry for ${geometryMap.size} ward-sections\n`);

  // Step 2: Load correct dates and match with geometry
  console.log('📂 Loading dates CSV and merging...');
  const completeRecords = [];
  let matched = 0;
  let missing = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream('/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv')
      .pipe(csv())
      .on('data', (row) => {
        const key = `${row.ward}-${row.section}`;
        const geomData = geometryMap.get(key);

        if (geomData) {
          // Merge: use correct date from this CSV, geometry from other CSV
          completeRecords.push({
            ward: row.ward,
            section: row.section,
            cleaning_date: row.cleaning_date,
            // Geometry (skip full geom, only use simplified for maps)
            geom_simplified: geomData.geom_simplified,
            // Boundary streets
            east_block: geomData.east_block,
            west_block: geomData.west_block,
            north_block: geomData.north_block,
            south_block: geomData.south_block,
            east_street: geomData.east_street,
            east_block_number: geomData.east_block_number,
            east_direction: geomData.east_direction,
            west_street: geomData.west_street,
            west_block_number: geomData.west_block_number,
            west_direction: geomData.west_direction,
            north_street: geomData.north_street,
            north_block_number: geomData.north_block_number,
            north_direction: geomData.north_direction,
            south_street: geomData.south_street,
            south_block_number: geomData.south_block_number,
            south_direction: geomData.south_direction,
            // Metadata
            street_name: geomData.street_name || null,
            side: geomData.side || null,
            ward_section: `${row.ward.padStart(3, '0')}-${row.section}-${row.cleaning_date}`
          });
          matched++;
        } else {
          missing++;
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Matched: ${matched} records`);
  console.log(`⚠️  Missing geometry: ${missing} records\n`);

  if (completeRecords.length === 0) {
    console.error('❌ No records to import!');
    process.exit(1);
  }

  // Step 3: Import to MSC database
  console.log('📤 Importing to MSC database...');
  await importToDatabase(mscSupabase, completeRecords, 'MSC');

  // Step 4: Import to TicketlessAmerica database
  console.log('\n📤 Importing to TicketlessAmerica database...');
  await importToDatabase(taSupabase, completeRecords, 'TicketlessAmerica');

  console.log('\n🎉 SUCCESS! Both databases updated with complete data');
  console.log('   ✅ Geometry data for maps');
  console.log('   ✅ Correct 2025-2026 dates');
  console.log('   ✅ Boundary street information');
}

async function importToDatabase(supabaseClient, records, dbName) {
  // Clear existing data
  console.log(`  🗑️  Clearing ${dbName} data...`);
  const { error: deleteError } = await supabaseClient
    .from('street_cleaning_schedule')
    .delete()
    .neq('ward', 'IMPOSSIBLE');

  if (deleteError) {
    console.error(`  ❌ Delete error:`, deleteError.message);
    throw deleteError;
  }

  // Insert in batches
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error: insertError } = await supabaseClient
      .from('street_cleaning_schedule')
      .insert(batch);

    if (insertError) {
      console.error(`  ❌ Insert error at batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
      throw insertError;
    }

    inserted += batch.length;
    process.stdout.write(`\r  Progress: ${inserted}/${records.length}`);
  }

  console.log('');

  // Verify
  const { count } = await supabaseClient
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`  ✅ ${dbName}: ${count} rows imported`);

  // Verify geometry
  const { data: withGeom } = await supabaseClient
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .limit(1);

  if (withGeom && withGeom.length > 0) {
    console.log(`  ✅ Geometry verified for ${dbName}`);
  } else {
    console.log(`  ⚠️  Warning: No geometry found in ${dbName}`);
  }
}

importComplete().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});