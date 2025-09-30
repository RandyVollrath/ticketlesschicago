#!/usr/bin/env node
/**
 * Fixes dates in the geometry CSV by matching with correct dates CSV
 * Outputs a new CSV ready for Supabase dashboard import
 */

const fs = require('fs');
const csv = require('csv-parser');

async function fixDates() {
  console.log('🔧 Fixing dates in geometry CSV\n');

  // Load correct dates
  console.log('📂 Loading correct dates...');
  const correctDates = new Map();

  await new Promise((resolve, reject) => {
    fs.createReadStream('/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv')
      .pipe(csv())
      .on('data', (row) => {
        const key = `${row.ward}-${row.section}`;
        if (!correctDates.has(key)) {
          correctDates.set(key, []);
        }
        correctDates.get(key).push(row.cleaning_date);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Loaded ${correctDates.size} ward-sections with correct dates\n`);

  // Process geometry CSV and fix dates
  console.log('📂 Processing geometry CSV...');
  const outputLines = [];
  let headersWritten = false;

  await new Promise((resolve, reject) => {
    fs.createReadStream('/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv')
      .pipe(csv())
      .on('data', (row) => {
        if (!headersWritten) {
          // Write headers
          outputLines.push(Object.keys(row).join(','));
          headersWritten = true;
        }

        const key = `${row.ward}-${row.section}`;
        const dates = correctDates.get(key);

        if (dates && dates.length > 0) {
          // Create a row for each correct date
          dates.forEach(correctDate => {
            const newRow = { ...row };
            newRow.cleaning_date = correctDate;
            newRow.ward_section = `${row.ward.padStart(3, '0')}-${row.section}-${correctDate}`;

            // Convert to CSV line
            const values = Object.values(newRow).map(v =>
              v && v.includes(',') ? `"${v}"` : v
            );
            outputLines.push(values.join(','));
          });
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Write output
  const outputPath = '/tmp/street_cleaning_COMPLETE.csv';
  fs.writeFileSync(outputPath, outputLines.join('\n'));

  console.log(`\n✅ Fixed CSV written to: ${outputPath}`);
  console.log(`   Total rows: ${outputLines.length - 1}`);
  console.log('\n🎯 Next steps:');
  console.log('   1. Open Supabase dashboard');
  console.log('   2. Go to street_cleaning_schedule table');
  console.log('   3. Import this CSV file');
  console.log('   4. Repeat for both MSC and TicketlessAmerica databases');
}

fixDates().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});