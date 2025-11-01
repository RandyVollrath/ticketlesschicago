// Import Chicago towing data from city API
// Data source: https://data.cityofchicago.org/Transportation/Towed-Vehicles/ygr5-vcbg
//
// This imports the last 90 days of towing data to start
// After initial import, use the daily sync cron to keep updated

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function importTowingData() {
  console.log('Starting towing data import...');

  // Get last 90 days of data (API limit is usually 1000 records per request)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const dateFilter = ninetyDaysAgo.toISOString().split('T')[0];

  let offset = 0;
  const limit = 1000;
  let totalImported = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`\nFetching records ${offset} to ${offset + limit}...`);

    // Fetch from Chicago API
    const url = `https://data.cityofchicago.org/resource/ygr5-vcbg.json?$where=tow_date>='${dateFilter}'&$limit=${limit}&$offset=${offset}&$order=tow_date DESC`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data || data.length === 0) {
      console.log('No more records to fetch');
      hasMore = false;
      break;
    }

    console.log(`Fetched ${data.length} records from API`);

    // Transform and insert data (filter out records with null plates)
    const records = data
      .filter(item => item.plate && item.plate.trim() !== '')
      .map(item => ({
        tow_date: item.tow_date,
        make: item.make,
        style: item.style,
        color: item.color,
        plate: item.plate.trim().toUpperCase(),
        state: item.state || 'IL',
        towed_to_address: item.towed_to_address,
        tow_facility_phone: item.tow_facility_phone,
        inventory_number: item.inventory_number
      }));

    // Insert with upsert to avoid duplicates
    const { data: inserted, error } = await supabase
      .from('towed_vehicles')
      .upsert(records, {
        onConflict: 'inventory_number',
        ignoreDuplicates: true
      });

    if (error) {
      console.error('Error inserting records:', error);
      // Continue anyway - some duplicates are expected
    } else {
      console.log(`✓ Inserted ${records.length} records (${data.length - records.length} skipped due to missing plates)`);
    }

    totalImported += records.length;
    offset += limit;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n✅ Import complete! Total records processed: ${totalImported}`);

  // Show stats
  const { count } = await supabase
    .from('towed_vehicles')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Total records in database: ${count}`);

  // Show most recent tow
  const { data: recent } = await supabase
    .from('towed_vehicles')
    .select('*')
    .order('tow_date', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    console.log(`\n🚗 Most recent tow:`);
    console.log(`   Plate: ${recent[0].plate} (${recent[0].state})`);
    console.log(`   Date: ${recent[0].tow_date}`);
    console.log(`   Location: ${recent[0].towed_to_address}`);
  }
}

importTowingData().catch(console.error);
