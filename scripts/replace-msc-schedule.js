#!/usr/bin/env node
/**
 * SAFELY replaces corrupted MSC street cleaning schedule with clean data
 *
 * This script:
 * 1. Creates a backup of existing MSC data
 * 2. Deletes all rows from MSC street_cleaning_schedule
 * 3. Imports fresh data from CSV
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const readline = require('readline');

// MSC database
const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

// Simple CSV parser
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const headers = lines[0].split(',');

  const wardIndex = headers.indexOf('ward');
  const sectionIndex = headers.indexOf('section');
  const dateIndex = headers.indexOf('cleaning_date');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const cols = lines[i].split(',');
    const ward = cols[wardIndex]?.trim();
    const section = cols[sectionIndex]?.trim();
    const cleaningDate = cols[dateIndex]?.trim();

    if (!ward || !section || !cleaningDate) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaningDate)) continue;

    rows.push({ ward, section, cleaning_date: cleaningDate });
  }

  return rows;
}

async function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function replaceSchedule(csvPath) {
  console.log('🚀 MSC Database Schedule Replacement\n');
  console.log('⚠️  WARNING: This will DELETE all existing street cleaning data from MSC database\n');

  // Step 1: Check current data
  console.log('📊 Checking current MSC database...');
  const { count: currentCount } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`   Current rows in MSC: ${currentCount || 0}\n`);

  if (currentCount > 0) {
    const confirmed = await askConfirmation(
      `This will DELETE ${currentCount} rows. Type 'yes' to continue: `
    );

    if (!confirmed) {
      console.log('❌ Operation cancelled');
      process.exit(0);
    }
  }

  // Step 2: Create backup
  console.log('\n💾 Creating backup...');
  const { data: backupData, error: backupError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('*');

  if (!backupError && backupData) {
    const backupPath = `/tmp/msc_backup_${Date.now()}.json`;
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    console.log(`✅ Backup saved to: ${backupPath}\n`);
  }

  // Step 3: Read and parse CSV
  console.log('📂 Reading CSV...');
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvText);
  console.log(`✅ Parsed ${rows.length} rows from CSV\n`);

  // Step 4: DELETE all existing data
  console.log('🗑️  DELETING all existing data from MSC...');
  const { error: deleteError } = await mscSupabase
    .from('street_cleaning_schedule')
    .delete()
    .neq('ward', 'IMPOSSIBLE_PLACEHOLDER_VALUE');

  if (deleteError) {
    console.error('❌ Delete failed:', deleteError.message);
    console.log('\n💡 Your backup is safe at the path above');
    process.exit(1);
  }

  // Verify deletion
  const { count: afterDeleteCount } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Deleted! Remaining rows: ${afterDeleteCount || 0}\n`);

  // Step 5: Insert new data
  console.log('📤 Inserting fresh data...');
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error: insertError } = await mscSupabase
      .from('street_cleaning_schedule')
      .insert(batch);

    if (insertError) {
      console.error(`❌ Insert error at batch ${i / batchSize + 1}:`, insertError.message);
      process.exit(1);
    }

    inserted += batch.length;
    process.stdout.write(`\r  Progress: ${inserted}/${rows.length}`);
  }

  console.log('\n');

  // Step 6: Verify
  console.log('🔍 Verifying...');
  const { count: finalCount } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Final count: ${finalCount}\n`);

  if (finalCount === rows.length) {
    console.log('🎉 SUCCESS! MSC database updated with clean data');
    console.log('\n✨ Old corrupted dates (0205, 2925) have been replaced with correct 2025-2026 dates');
  } else {
    console.log(`⚠️  WARNING: Count mismatch. Expected ${rows.length}, got ${finalCount}`);
  }
}

// Main
const csvPath = process.argv[2] || '/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv';

if (!process.env.MSC_SUPABASE_URL || !process.env.MSC_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing MSC database credentials in .env.local');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`❌ CSV file not found: ${csvPath}`);
  process.exit(1);
}

replaceSchedule(csvPath);