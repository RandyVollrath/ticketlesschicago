#!/usr/bin/env node
/**
 * Imports geometry CSV via SQL query (bypassing JS client geometry parsing issues)
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const readline = require('readline');

const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function importViaSQL() {
  console.log('🚀 Importing geometry data via SQL\n');

  // Read the geometry CSV line by line
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

  // Import to MSC first
  console.log('📤 Importing to MSC database...');
  await importToDatabase(mscSupabase, headers, rows, 'MSC');

  // Import to TicketlessAmerica
  console.log('\n📤 Importing to TicketlessAmerica database...');
  await importToDatabase(taSupabase, headers, rows, 'TicketlessAmerica');

  console.log('\n✅ Import complete! Now running date fix...\n');

  // Run date fix
  const { spawn } = require('child_process');
  const updateProcess = spawn('node', ['scripts/update-dates-after-import.js'], {
    stdio: 'inherit'
  });

  updateProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n🎉 ALL DONE! Both databases are fixed');
    } else {
      console.log('\n⚠️  Date update had issues - you may need to run it manually');
    }
  });
}

async function importToDatabase(supabase, headers, rows, dbName) {
  // Clear existing data
  console.log(`  🗑️  Clearing ${dbName} data...`);
  const { error: deleteError } = await supabase
    .from('street_cleaning_schedule')
    .delete()
    .neq('ward', 'IMPOSSIBLE');

  if (deleteError) {
    console.error(`  ❌ Delete error:`, deleteError.message);
    throw deleteError;
  }

  // Parse and insert rows in batches
  const batchSize = 100; // Smaller batches for large geometry data
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    // Parse each CSV line into object
    const records = batch.map(line => {
      const values = parseCSVLine(line);
      const obj = {};

      headers.forEach((header, idx) => {
        const value = values[idx];
        // Handle nulls and empty strings
        if (value === null || value === undefined || value === '') {
          obj[header] = null;
        } else {
          obj[header] = value;
        }
      });

      return obj;
    });

    // Try inserting this batch
    const { error: insertError } = await supabase
      .from('street_cleaning_schedule')
      .insert(records);

    if (insertError) {
      console.log(`  ⚠️  Batch ${Math.floor(i / batchSize) + 1} failed:`, insertError.message);
      failed += batch.length;
    } else {
      inserted += batch.length;
    }

    process.stdout.write(`\r  Progress: ${inserted}/${rows.length} (${failed} failed)`);
  }

  console.log('');

  // Verify
  const { count } = await supabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`  ✅ ${dbName}: ${count} rows imported`);

  // Check geometry
  const { data: withGeom } = await supabase
    .from('street_cleaning_schedule')
    .select('ward, section')
    .not('geom_simplified', 'is', null)
    .limit(1);

  if (withGeom && withGeom.length > 0) {
    console.log(`  ✅ Geometry verified!`);
  }
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

importViaSQL().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});