#!/usr/bin/env node
/**
 * Imports street cleaning schedule from CSV into TicketlessAmerica database
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// TicketlessAmerica database
const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse CSV manually (simple parser for our known format)
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const headers = lines[0].split(',');

  const wardIndex = headers.indexOf('ward');
  const sectionIndex = headers.indexOf('section');
  const dateIndex = headers.indexOf('cleaning_date');

  if (wardIndex === -1 || sectionIndex === -1 || dateIndex === -1) {
    throw new Error('CSV missing required columns: ward, section, cleaning_date');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue; // Skip empty lines

    const cols = lines[i].split(',');
    const ward = cols[wardIndex]?.trim();
    const section = cols[sectionIndex]?.trim();
    const cleaningDate = cols[dateIndex]?.trim();

    // Validate data
    if (!ward || !section || !cleaningDate) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaningDate)) {
      console.warn(`⚠️  Skipping row ${i}: Invalid date format: ${cleaningDate}`);
      continue;
    }

    rows.push({
      ward,
      section,
      cleaning_date: cleaningDate
    });
  }

  return rows;
}

async function importCSV(csvPath) {
  console.log('🚀 Starting CSV import...\n');

  try {
    // Read CSV file
    console.log(`📂 Reading CSV from: ${csvPath}`);
    const csvText = fs.readFileSync(csvPath, 'utf-8');

    // Parse CSV
    console.log('📊 Parsing CSV data...');
    const rows = parseCSV(csvText);
    console.log(`✅ Parsed ${rows.length} valid rows\n`);

    if (rows.length === 0) {
      console.log('❌ No valid data to import');
      process.exit(1);
    }

    // Show sample
    console.log('📋 Sample data:');
    console.log(rows.slice(0, 5).map(r => `  Ward ${r.ward}, Section ${r.section}: ${r.cleaning_date}`).join('\n'));
    console.log('  ...\n');

    // Clear existing data
    console.log('🗑️  Clearing existing schedule data...');
    const { error: deleteError } = await taSupabase
      .from('street_cleaning_schedule')
      .delete()
      .neq('ward', 'PLACEHOLDER');

    if (deleteError && deleteError.code !== 'PGRST116') {
      console.error('❌ Error clearing data:', deleteError);
      process.exit(1);
    }
    console.log('✅ Existing data cleared\n');

    // Insert in batches
    const batchSize = 500;
    let insertedCount = 0;
    let failedCount = 0;
    const errors = [];

    console.log('📤 Inserting data into database...');

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      const { error: insertError } = await taSupabase
        .from('street_cleaning_schedule')
        .insert(batch);

      if (insertError) {
        console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
        failedCount += batch.length;
        errors.push(insertError.message);
      } else {
        insertedCount += batch.length;
        process.stdout.write(`\r  Progress: ${insertedCount}/${rows.length} rows inserted`);
      }
    }

    console.log('\n');

    // Summary
    console.log('📊 Import Summary:');
    console.log(`   Total rows in CSV: ${rows.length}`);
    console.log(`   Successfully inserted: ${insertedCount}`);
    console.log(`   Failed: ${failedCount}`);

    if (failedCount > 0) {
      console.log('\n⚠️  WARNING: Some rows failed to import');
      console.log('Errors:', errors.slice(0, 3));
      process.exit(1);
    }

    // Verify
    console.log('\n🔍 Verifying import...');
    const { count, error: verifyError } = await taSupabase
      .from('street_cleaning_schedule')
      .select('*', { count: 'exact', head: true });

    if (verifyError) {
      console.error('❌ Verification error:', verifyError);
      process.exit(1);
    }

    console.log(`✅ Verified: ${count} rows in database`);

    if (count === rows.length) {
      console.log('\n🎉 Import completed successfully!');

      // Show some stats
      const { data: stats } = await taSupabase.rpc('get_import_stats', {}, { count: 'exact' }).catch(() => ({ data: null }));

      const { data: sampleDates } = await taSupabase
        .from('street_cleaning_schedule')
        .select('cleaning_date')
        .order('cleaning_date', { ascending: true })
        .limit(1);

      const { data: latestDates } = await taSupabase
        .from('street_cleaning_schedule')
        .select('cleaning_date')
        .order('cleaning_date', { ascending: false })
        .limit(1);

      if (sampleDates?.length && latestDates?.length) {
        console.log(`\n📅 Date range: ${sampleDates[0].cleaning_date} to ${latestDates[0].cleaning_date}`);
      }

    } else {
      console.log(`\n⚠️  WARNING: Row count mismatch. Expected ${rows.length}, got ${count}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Main
const csvPath = process.argv[2] || '/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv';

if (!fs.existsSync(csvPath)) {
  console.error(`❌ CSV file not found: ${csvPath}`);
  console.log('\nUsage: node import-street-cleaning-csv.js [path-to-csv]');
  process.exit(1);
}

importCSV(csvPath);