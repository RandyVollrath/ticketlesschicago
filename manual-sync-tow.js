// Manual tow sync - run this to immediately sync tow data
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function manualSync() {
  console.log('🔄 Manually syncing tow data...\n');

  // Just fetch the most recent 5000 records (should cover last few days)
  const url = `https://data.cityofchicago.org/resource/ygr5-vcbg.json?$limit=5000&$order=tow_date DESC`;

  console.log(`Fetching latest 5000 tows from Chicago API...`);

  const response = await fetch(url);
  const data = await response.json();

  if (!Array.isArray(data)) {
    console.error('❌ API response is not an array:', data);
    return;
  }

  console.log(`✓ Fetched ${data.length} records from API\n`);

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

  console.log(`Processing ${records.length} valid records...`);

  const { data: inserted, error } = await supabase
    .from('towed_vehicles')
    .upsert(records, {
      onConflict: 'inventory_number',
      ignoreDuplicates: true
    });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`✅ Synced ${records.length} records to database\n`);

  // Check if XXKXKWS is now in there
  const { data: check } = await supabase
    .from('towed_vehicles')
    .select('*')
    .eq('plate', 'XXKXKWS')
    .single();

  if (check) {
    console.log('✓ XXKXKWS found in database!');
    console.log(`  Towed: ${check.tow_date}`);
    console.log(`  Location: ${check.towed_to_address}`);
  } else {
    console.log('⚠️  XXKXKWS not found in database');
  }
}

manualSync().catch(console.error);
