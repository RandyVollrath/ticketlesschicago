#!/usr/bin/env node

/**
 * Import San Francisco Street Sweeping Schedule data into Supabase
 *
 * This script:
 * 1. Reads the SF street sweeping CSV file
 * 2. Parses each row and converts LINESTRING to PostGIS geometry
 * 3. Inserts into the sf_street_sweeping table
 *
 * Run: node database/import-sf-street-sweeping.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials');
  console.error('SUPABASE_URL:', !!SUPABASE_URL);
  console.error('SUPABASE_SERVICE_KEY:', !!SUPABASE_SERVICE_KEY);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Parse CSV line handling quoted fields with commas
 */
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

/**
 * Convert LINESTRING WKT to GeoJSON and then to PostGIS format
 */
function parseLineString(linestring) {
  if (!linestring || !linestring.startsWith('LINESTRING')) {
    return null;
  }

  // Extract coordinates from "LINESTRING (-122.123 37.456, -122.124 37.457)"
  const coordsStr = linestring.replace('LINESTRING (', '').replace(')', '');
  const pairs = coordsStr.split(', ');

  const coordinates = pairs.map(pair => {
    const [lng, lat] = pair.trim().split(' ').map(Number);
    return [lng, lat];
  });

  // Return as GeoJSON LineString
  return {
    type: 'LineString',
    coordinates: coordinates
  };
}

/**
 * Import CSV data into Supabase
 */
async function importData() {
  const csvPath = path.join('/home/randy-vollrath/Downloads/Street_Sweeping_Schedule_20251031.csv');

  console.log('📂 Reading CSV file:', csvPath);

  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV file not found at:', csvPath);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  console.log(`📊 Found ${lines.length - 1} data rows (excluding header)`);

  // Skip header row
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

        if (fields.length < 17) {
          console.warn(`⚠️  Skipping malformed line: ${line.substring(0, 100)}...`);
          continue;
        }

        const [
          cnn,
          corridor,
          limits,
          cnnRightLeft,
          blockSide,
          fullName,
          weekDay,
          fromHour,
          toHour,
          week1,
          week2,
          week3,
          week4,
          week5,
          holidays,
          blockSweepId,
          linestring
        ] = fields;

        const geom = parseLineString(linestring);

        if (!geom) {
          console.warn(`⚠️  Skipping row with invalid geometry: ${cnn}`);
          errorCount++;
          continue;
        }

        records.push({
          cnn: cnn,
          corridor: corridor,
          limits: limits || null,
          cnn_right_left: cnnRightLeft || null,
          block_side: blockSide || null,
          full_name: fullName || null,
          week_day: weekDay,
          from_hour: parseInt(fromHour) || 0,
          to_hour: parseInt(toHour) || 0,
          week1: parseInt(week1) || 0,
          week2: parseInt(week2) || 0,
          week3: parseInt(week3) || 0,
          week4: parseInt(week4) || 0,
          week5: parseInt(week5) || 0,
          holidays: parseInt(holidays) || 0,
          block_sweep_id: blockSweepId || null,
          geom: `SRID=4326;LINESTRING(${geom.coordinates.map(c => `${c[0]} ${c[1]}`).join(', ')})`
        });

      } catch (err) {
        console.error(`❌ Error parsing line: ${err.message}`);
        errorCount++;
      }
    }

    if (records.length > 0) {
      const { data, error } = await supabase
        .from('sf_street_sweeping')
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
  console.log(`📈 Total processed: ${successCount + errorCount} records`);
}

// Run the import
importData()
  .then(() => {
    console.log('✅ Import complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
