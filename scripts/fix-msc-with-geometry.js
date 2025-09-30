#!/usr/bin/env node
/**
 * Fixes MSC database by:
 * 1. Restoring geometry data from backup
 * 2. Using correct cleaning dates from CSV
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

// Parse CSV
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const headers = lines[0].split(',');
  const dateIndex = headers.indexOf('cleaning_date');
  const wardSectionIndex = headers.indexOf('ward_section');

  const dateMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(',');
    const wardSection = cols[wardSectionIndex]?.trim();
    const cleaningDate = cols[dateIndex]?.trim();

    if (wardSection && cleaningDate && /^\d{4}-\d{2}-\d{2}$/.test(cleaningDate)) {
      // ward_section format: 031-002-2025-08-25
      // We want to map by ward-section (not including date)
      const parts = wardSection.split('-');
      if (parts.length >= 2) {
        const key = `${parseInt(parts[0])}-${parts[1]}`; // "31-2" or "31-002"
        if (!dateMap.has(key)) {
          dateMap.set(key, []);
        }
        dateMap.get(key).push(cleaningDate);
      }
    }
  }

  return dateMap;
}

async function fixDatabase() {
  console.log('🔧 Fixing MSC database with geometry + correct dates\n');

  // Load backup
  console.log('📂 Loading backup...');
  const backupPath = '/tmp/msc_backup_1759192983065.json';
  if (!fs.existsSync(backupPath)) {
    console.error('❌ Backup file not found:', backupPath);
    console.log('Available backups:');
    const backups = fs.readdirSync('/tmp').filter(f => f.startsWith('msc_backup_'));
    backups.forEach(b => console.log('  ', `/tmp/${b}`));
    process.exit(1);
  }

  const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
  console.log(`✅ Loaded ${backupData.length} rows from backup\n`);

  // Load CSV dates
  console.log('📂 Loading correct dates from CSV...');
  const csvPath = '/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv';
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const correctDates = parseCSV(csvText);
  console.log(`✅ Loaded dates for ${correctDates.size} ward-section combinations\n`);

  // Build complete records: backup geometry + CSV dates
  console.log('🔀 Merging geometry from backup with correct dates from CSV...');
  const completeRecords = [];

  backupData.forEach(row => {
    const key = `${row.ward}-${row.section}`;
    const dates = correctDates.get(key);

    if (dates && dates.length > 0) {
      // Create a row for each cleaning date
      dates.forEach(date => {
        completeRecords.push({
          ward: row.ward,
          section: row.section,
          cleaning_date: date,
          // Geometry data from backup
          geom: row.geom,
          geom_simplified: row.geom_simplified,
          // Boundary data from backup
          east_block: row.east_block,
          west_block: row.west_block,
          north_block: row.north_block,
          south_block: row.south_block,
          east_street: row.east_street,
          east_block_number: row.east_block_number,
          east_direction: row.east_direction,
          west_street: row.west_street,
          west_block_number: row.west_block_number,
          west_direction: row.west_direction,
          north_street: row.north_street,
          north_block_number: row.north_block_number,
          north_direction: row.north_direction,
          south_street: row.south_street,
          south_block_number: row.south_block_number,
          south_direction: row.south_direction,
          ward_section: row.ward_section,
          street_name: row.street_name,
          side: row.side
        });
      });
    }
  });

  console.log(`✅ Created ${completeRecords.length} complete records\n`);

  // Delete current data
  console.log('🗑️  Clearing current data...');
  const { error: deleteError } = await mscSupabase
    .from('street_cleaning_schedule')
    .delete()
    .neq('ward', 'IMPOSSIBLE');

  if (deleteError) {
    console.error('❌ Delete error:', deleteError.message);
    process.exit(1);
  }
  console.log('✅ Cleared\n');

  // Insert complete records
  console.log('📤 Inserting complete records...');
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < completeRecords.length; i += batchSize) {
    const batch = completeRecords.slice(i, i + batchSize);
    const { error: insertError } = await mscSupabase
      .from('street_cleaning_schedule')
      .insert(batch);

    if (insertError) {
      console.error(`❌ Insert error:`, insertError.message);
      process.exit(1);
    }

    inserted += batch.length;
    process.stdout.write(`\r  Progress: ${inserted}/${completeRecords.length}`);
  }

  console.log('\n');

  // Verify
  console.log('🔍 Verifying...');
  const { count } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Final count: ${count}\n`);

  // Test geometry
  const { data: withGeom } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section')
    .not('geom_simplified', 'is', null)
    .limit(1);

  if (withGeom && withGeom.length > 0) {
    console.log('✅ Geometry data present!');
    console.log('   Sample ward with geom:', withGeom[0].ward, 'section:', withGeom[0].section);
  } else {
    console.log('⚠️  Warning: No geometry data found');
  }

  console.log('\n🎉 SUCCESS! MSC database has geometry + correct dates');
}

fixDatabase();