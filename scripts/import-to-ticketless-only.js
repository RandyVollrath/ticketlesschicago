#!/usr/bin/env node
/**
 * Import geometry data to TicketlessAmerica database only
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const readline = require('readline');

const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function importToTicketless() {
  console.log('🚀 Importing to TicketlessAmerica database\n');

  // Read the geometry CSV
  console.log('📂 Reading geometry CSV...');
  const rows = [];
  let headers = null;

  const fileStream = fs.createReadStream('/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!headers) {
      headers = line.split(',');
      continue;
    }
    if (line.trim()) {
      rows.push(line);
    }
  }

  console.log(`✅ Read ${rows.length} rows\n`);

  // Parse and insert
  console.log('📤 Inserting data...');
  const batchSize = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const records = batch.map(line => {
      const values = parseCSVLine(line);
      const obj = {};

      headers.forEach((header, idx) => {
        const value = values[idx];
        obj[header] = (value === null || value === undefined || value === '') ? null : value;
      });

      return obj;
    });

    const { error: insertError } = await taSupabase
      .from('street_cleaning_schedule')
      .insert(records);

    if (insertError) {
      failed += batch.length;
    } else {
      inserted += batch.length;
    }

    process.stdout.write(`\r  Progress: ${inserted}/${rows.length} (${failed} failed)`);
  }

  console.log('\n');

  // Verify
  const { count } = await taSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ TicketlessAmerica: ${count} rows imported`);

  // Check geometry
  const { data: withGeom } = await taSupabase
    .from('street_cleaning_schedule')
    .select('ward, section')
    .not('geom_simplified', 'is', null)
    .limit(1);

  if (withGeom && withGeom.length > 0) {
    console.log('✅ Geometry verified!\n');
  }

  console.log('✅ Import complete! Now fixing dates...\n');

  // Run date fix
  const { spawn } = require('child_process');
  const updateProcess = spawn('node', ['scripts/update-dates-after-import.js'], {
    stdio: 'inherit'
  });

  updateProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n🎉 ALL DONE!');
    }
  });
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

importToTicketless().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});