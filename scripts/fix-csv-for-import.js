#!/usr/bin/env node
/**
 * Fix exported CSV for import to TicketlessAmerica
 * Removes ID column and ensures compatibility
 */

const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

async function fixCSV() {
  console.log('🔧 Fixing CSV for import to TicketlessAmerica\n');

  const inputPath = '/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(8).csv';
  const outputPath = '/home/randy-vollrath/Downloads/street_cleaning_FIXED.csv';

  console.log('📂 Reading CSV...');
  const rows = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(csv())
      .on('data', (row) => {
        // Remove id field - let database auto-generate
        const { id, ...cleanRow } = row;
        rows.push(cleanRow);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Read ${rows.length} rows\n`);

  // Get headers from first row (excluding id)
  const headers = Object.keys(rows[0]).map(key => ({
    id: key,
    title: key
  }));

  console.log('📋 Columns in fixed CSV:');
  console.log('  ', headers.map(h => h.id).join(', '));

  // Write fixed CSV
  console.log('\n📝 Writing fixed CSV...');
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: headers
  });

  await csvWriter.writeRecords(rows);

  console.log(`✅ Fixed CSV written to: ${outputPath}`);
  console.log(`   Rows: ${rows.length}`);
  console.log(`   Columns: ${headers.length}`);
  console.log('\n🎯 Now import this file to TicketlessAmerica:');
  console.log('   1. Go to: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/editor');
  console.log('   2. Select street_cleaning_schedule table');
  console.log('   3. Click "Insert" → "Import data from CSV"');
  console.log(`   4. Upload: ${outputPath}`);
}

fixCSV().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});