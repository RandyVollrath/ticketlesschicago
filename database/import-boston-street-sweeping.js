#!/usr/bin/env node

/**
 * Import Boston Street Sweeping Schedule data into Supabase
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseBoolean(val) {
  return val === 't' || val === 'true' || val === '1';
}

async function importData() {
  const csvPath = path.join('/home/randy-vollrath/Downloads/Boston_Street_Sweeping_20251101.csv');

  console.log('📂 Reading CSV file:', csvPath);

  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV file not found');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  console.log(`📊 Found ${lines.length - 1} data rows`);

  const dataLines = lines.slice(1);
  let successCount = 0;
  let errorCount = 0;
  const batchSize = 100;

  for (let i = 0; i < dataLines.length; i += batchSize) {
    const batch = dataLines.slice(i, i + batchSize);
    const records = [];

    for (const line of batch) {
      try {
        const fields = parseCSVLine(line);

        if (fields.length < 31) {
          console.warn(`⚠️  Skipping malformed line`);
          continue;
        }

        const [
          main_id, st_name, dist, dist_name, start_time, end_time, side,
          from_street, to_street, miles, section, one_way, week_1, week_2,
          week_3, week_4, week_5, sunday, monday, tuesday, wednesday,
          thursday, friday, saturday, every_day, year_round, north_end_pilot,
          timestamp, parent, losta, hista
        ] = fields;

        records.push({
          main_id: parseInt(main_id) || null,
          st_name: st_name || null,
          dist: dist || null,
          dist_name: dist_name || null,
          start_time: start_time || null,
          end_time: end_time || null,
          side: side || null,
          from_street: from_street || null,
          to_street: to_street || null,
          miles: parseFloat(miles) || null,
          section: section || null,
          one_way: parseBoolean(one_way),
          week_1: parseBoolean(week_1),
          week_2: parseBoolean(week_2),
          week_3: parseBoolean(week_3),
          week_4: parseBoolean(week_4),
          week_5: parseBoolean(week_5),
          sunday: parseBoolean(sunday),
          monday: parseBoolean(monday),
          tuesday: parseBoolean(tuesday),
          wednesday: parseBoolean(wednesday),
          thursday: parseBoolean(thursday),
          friday: parseBoolean(friday),
          saturday: parseBoolean(saturday),
          every_day: parseBoolean(every_day),
          year_round: parseBoolean(year_round),
          north_end_pilot: parseBoolean(north_end_pilot),
          parent: parent || null,
          losta: parseInt(losta) || null,
          hista: parseInt(hista) || null
        });

      } catch (err) {
        console.error(`❌ Error parsing line:`, err.message);
        errorCount++;
      }
    }

    if (records.length > 0) {
      const { error } = await supabase
        .from('boston_street_sweeping')
        .insert(records);

      if (error) {
        console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, error.message);
        errorCount += records.length;
      } else {
        successCount += records.length;
        console.log(`✅ Inserted batch ${i / batchSize + 1}: ${records.length} records (total: ${successCount})`);
      }
    }
  }

  console.log('\n📊 Import Summary:');
  console.log(`✅ Successfully imported: ${successCount} records`);
  console.log(`❌ Errors: ${errorCount} records`);
}

importData()
  .then(() => {
    console.log('✅ Import complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
