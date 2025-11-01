const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function importSanDiegoData() {
  const csvPath = path.join('/home/randy-vollrath/Downloads', 'street_sweeping_datasd.csv');

  console.log('Reading CSV file...');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');

  // Skip header
  const header = lines[0];
  console.log('Header:', header);

  const segments = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handle quoted fields)
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current); // Add last field

    if (fields.length < 15) continue;

    segments.push({
      objectid: parseInt(fields[0]) || null,
      sapid: fields[1] || null,
      rd20full: fields[2] || null,
      llowaddr: fields[3] || null,
      lhighaddr: fields[4] || null,
      rlowaddr: fields[5] || null,
      rhighaddr: fields[6] || null,
      xstrt1: fields[7] || null,
      xstrt2: fields[8] || null,
      cdcode: fields[9] || null,
      cpcode: fields[10] || null,
      zip: fields[11] || null,
      posted: fields[12] || null,
      schedule: fields[13] || null,
      schedule2: fields[14] || null
    });
  }

  console.log(`\nParsed ${segments.length} segments`);
  console.log('Sample segment:', segments[0]);

  // Insert in batches
  const batchSize = 1000;
  let inserted = 0;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('sd_street_sweeping')
      .insert(batch);

    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
      throw error;
    }

    inserted += batch.length;
    console.log(`Inserted ${inserted} / ${segments.length} segments`);
  }

  console.log('\n✅ Import complete!');

  // Get some stats
  const { data: stats } = await supabase
    .from('sd_street_sweeping')
    .select('schedule', { count: 'exact' });

  console.log(`\nTotal segments in database: ${stats?.length || 0}`);
}

importSanDiegoData().catch(console.error);
