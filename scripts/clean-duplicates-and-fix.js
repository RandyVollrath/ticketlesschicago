#!/usr/bin/env node
/**
 * Clean duplicates from MSC and ensure we have all correct dates
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const csv = require('csv-parser');

const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

async function cleanAndFix() {
  console.log('🧹 Cleaning duplicates and fixing MSC database\n');

  // Step 1: Load what SHOULD be there from CSV
  console.log('📂 Loading correct data from CSV...');
  const correctData = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream('/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv')
      .pipe(csv())
      .on('data', (row) => {
        correctData.push({
          ward: row.ward,
          section: row.section,
          cleaning_date: row.cleaning_date
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Loaded ${correctData.length} correct records from CSV\n`);

  // Step 2: Fetch all current data with IDs
  console.log('📥 Fetching current MSC data...');
  let allCurrent = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('id, ward, section, cleaning_date, geom_simplified')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (!data || data.length === 0) break;
    allCurrent = allCurrent.concat(data);
    console.log(`  Fetched: ${allCurrent.length}...`);

    if (data.length < pageSize) break;
    page++;
  }

  console.log(`✅ Fetched ${allCurrent.length} current rows\n`);

  // Step 3: Find duplicates and decide which to keep
  console.log('🔍 Identifying duplicates...');
  const keepMap = new Map(); // ward-section-date -> row to keep
  const deleteIds = [];

  allCurrent.forEach(row => {
    const key = `${row.ward}-${row.section}-${row.cleaning_date}`;

    if (!keepMap.has(key)) {
      // First occurrence - keep it
      keepMap.set(key, row);
    } else {
      // Duplicate - mark for deletion
      // Prefer keeping rows with geometry
      const existing = keepMap.get(key);
      if (row.geom_simplified && !existing.geom_simplified) {
        // This duplicate has geometry, keep it instead
        deleteIds.push(existing.id);
        keepMap.set(key, row);
      } else {
        // Delete this duplicate
        deleteIds.push(row.id);
      }
    }
  });

  console.log(`✅ Found ${deleteIds.length} duplicates to delete\n`);

  // Step 4: Delete duplicates in batches
  if (deleteIds.length > 0) {
    console.log('🗑️  Deleting duplicates...');
    const batchSize = 500;

    for (let i = 0; i < deleteIds.length; i += batchSize) {
      const batch = deleteIds.slice(i, i + batchSize);
      const { error } = await mscSupabase
        .from('street_cleaning_schedule')
        .delete()
        .in('id', batch);

      if (error) {
        console.error('Delete error:', error.message);
      } else {
        process.stdout.write(`\r  Deleted: ${Math.min(i + batchSize, deleteIds.length)}/${deleteIds.length}`);
      }
    }
    console.log('\n');
  }

  // Step 5: Check what's missing
  console.log('🔍 Checking for missing records...');
  const currentKeys = new Set(Array.from(keepMap.keys()));
  const missing = [];

  correctData.forEach(row => {
    const key = `${row.ward}-${row.section}-${row.cleaning_date}`;
    if (!currentKeys.has(key)) {
      missing.push(row);
    }
  });

  console.log(`⚠️  Missing ${missing.length} records\n`);

  if (missing.length > 0 && missing.length < 20) {
    console.log('Sample missing:');
    missing.slice(0, 10).forEach(r => {
      console.log(`  Ward ${r.ward}, Section ${r.section}: ${r.cleaning_date}`);
    });
  }

  // Step 6: Verify final count
  const { count: finalCount } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`\n✅ Final MSC count: ${finalCount}`);
  console.log(`   Expected: ${correctData.length}`);
  console.log(`   Difference: ${finalCount - correctData.length}`);

  if (finalCount === correctData.length) {
    console.log('\n🎉 Perfect! MSC database is clean');
  } else if (Math.abs(finalCount - correctData.length) < 50) {
    console.log('\n✅ Close enough - small differences may be due to missing geometry for some ward-sections');
  } else {
    console.log('\n⚠️  Significant difference - may need investigation');
  }
}

cleanAndFix().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});