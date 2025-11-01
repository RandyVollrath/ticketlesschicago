const fs = require('fs');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function parseRouteNumber(routeNo) {
  const route = routeNo.trim();

  // Extract day from route number (e.g., "10P136 W" -> "W", "10P137 M" -> "M")
  const dayMatch = route.match(/\s+(M|Tu|W|Th|F)$/);

  if (dayMatch) {
    return dayMatch[1];
  }

  return null;
}

async function importData() {
  const csvFilePath = '/tmp/la_street_sweeping.csv';
  const schedules = [];

  console.log('📖 Reading CSV file...');

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const dayOfWeek = parseRouteNumber(row['Route No']);

        schedules.push({
          route_no: row['Route No'],
          council_district: row['Council District'],
          time_start: row['Time Start'],
          time_end: row['Time End'],
          boundaries: row['Boundaries'],
          day_of_week: dayOfWeek
        });
      })
      .on('end', async () => {
        console.log(`✅ Parsed ${schedules.length} schedules from CSV`);
        console.log('📤 Uploading to Supabase...');

        // Insert in batches of 100
        const batchSize = 100;
        let imported = 0;

        for (let i = 0; i < schedules.length; i += batchSize) {
          const batch = schedules.slice(i, i + batchSize);

          const { error } = await supabase
            .from('la_street_sweeping')
            .insert(batch);

          if (error) {
            console.error('❌ Error inserting batch:', error);
            reject(error);
            return;
          }

          imported += batch.length;
          console.log(`✅ Imported ${imported}/${schedules.length} schedules`);
        }

        console.log('🎉 Import complete!');
        resolve();
      })
      .on('error', (error) => {
        console.error('❌ Error reading CSV:', error);
        reject(error);
      });
  });
}

importData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
