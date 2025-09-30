#!/usr/bin/env node
/**
 * Updates dates in imported geometry data to match correct dates from CSV
 * Run this AFTER importing geometry CSV via Supabase dashboard
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const csv = require('csv-parser');

const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateDates() {
  console.log('🔧 Updating dates in imported data\n');

  // Load correct dates grouped by ward-section
  console.log('📂 Loading correct dates from CSV...');
  const correctDatesMap = new Map();

  await new Promise((resolve, reject) => {
    fs.createReadStream('/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv')
      .pipe(csv())
      .on('data', (row) => {
        const key = `${row.ward}-${row.section}`;
        if (!correctDatesMap.has(key)) {
          correctDatesMap.set(key, []);
        }
        correctDatesMap.get(key).push(row.cleaning_date);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Loaded correct dates for ${correctDatesMap.size} ward-sections\n`);

  // Update both databases
  await updateDatabase(mscSupabase, correctDatesMap, 'MSC');
  await updateDatabase(taSupabase, correctDatesMap, 'TicketlessAmerica');

  console.log('\n🎉 SUCCESS! Dates updated in both databases');
}

async function updateDatabase(supabase, correctDatesMap, dbName) {
  console.log(`\n📤 Updating ${dbName} database...`);

  // Get all current ward-sections
  const { data: current } = await supabase
    .from('street_cleaning_schedule')
    .select('id, ward, section, cleaning_date');

  if (!current || current.length === 0) {
    console.log(`  ⚠️  No data found in ${dbName} - did you import the CSV first?`);
    return;
  }

  console.log(`  Found ${current.length} rows to check`);

  // Group current data by ward-section
  const currentByKey = new Map();
  current.forEach(row => {
    const key = `${row.ward}-${row.section}`;
    if (!currentByKey.has(key)) {
      currentByKey.set(key, []);
    }
    currentByKey.get(key).push(row);
  });

  let updated = 0;
  let deleted = 0;
  let inserted = 0;

  // For each ward-section, ensure we have the right dates
  for (const [key, correctDates] of correctDatesMap) {
    const currentRows = currentByKey.get(key) || [];

    if (currentRows.length === 0) {
      console.log(`  ⚠️  Missing ward-section: ${key}`);
      continue;
    }

    // Keep first row as template, delete others
    const template = currentRows[0];

    if (currentRows.length > 1) {
      // Delete extra rows
      const idsToDelete = currentRows.slice(1).map(r => r.id);
      const { error } = await supabase
        .from('street_cleaning_schedule')
        .delete()
        .in('id', idsToDelete);

      if (!error) {
        deleted += idsToDelete.length;
      }
    }

    // Now handle dates
    for (let i = 0; i < correctDates.length; i++) {
      const correctDate = correctDates[i];

      if (i === 0) {
        // Update the first row
        const { error } = await supabase
          .from('street_cleaning_schedule')
          .update({
            cleaning_date: correctDate,
            ward_section: `${template.ward.padStart(3, '0')}-${template.section}-${correctDate}`
          })
          .eq('id', template.id);

        if (!error) updated++;
      } else {
        // Insert additional rows (duplicate geometry with different date)
        const { data: fullRow } = await supabase
          .from('street_cleaning_schedule')
          .select('*')
          .eq('id', template.id)
          .single();

        if (fullRow) {
          const newRow = {
            ...fullRow,
            id: undefined, // Let DB generate new ID
            cleaning_date: correctDate,
            ward_section: `${fullRow.ward.padStart(3, '0')}-${fullRow.section}-${correctDate}`
          };

          const { error } = await supabase
            .from('street_cleaning_schedule')
            .insert(newRow);

          if (!error) inserted++;
        }
      }
    }
  }

  console.log(`  ✅ Updated: ${updated} rows`);
  console.log(`  ✅ Inserted: ${inserted} rows`);
  console.log(`  ✅ Deleted: ${deleted} duplicate rows`);

  // Final count
  const { count } = await supabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`  ✅ Final count: ${count} rows in ${dbName}`);
}

updateDates().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});