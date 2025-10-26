/**
 * Complete setup script for the Two-Inch Snow Ban notification system
 *
 * This script will:
 * 1. Create the snow_routes table
 * 2. Import the CSV data from CDOT
 * 3. Verify the setup
 *
 * Run: node database/setup-snow-system.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('\n' + '='.repeat(70));
console.log('🌨️  TWO-INCH SNOW BAN NOTIFICATION SYSTEM SETUP');
console.log('='.repeat(70) + '\n');

console.log('⚠️  MANUAL STEP REQUIRED:');
console.log('\n1. Go to your Supabase Dashboard → SQL Editor');
console.log('2. Copy and paste the SQL from:');
console.log('   database/create-snow-routes-table.sql');
console.log('3. Execute the SQL to create the table');
console.log('4. Come back here and press ENTER to continue...\n');

// Wait for user to press Enter
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Press ENTER when you have created the table... ', async () => {
  rl.close();

  console.log('\n✓ Proceeding with CSV import...\n');

  try {
    await importSnowRoutes();
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
});

async function importSnowRoutes() {
  // Read CSV file
  const csvPath = path.join(__dirname, '../Snow_Route_Parking_Restrictions_20251024.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    console.error('Make sure the CSV file is in the project root directory');
    process.exit(1);
  }

  console.log(`📄 Reading CSV: ${path.basename(csvPath)}`);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  // Parse CSV
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`✓ Parsed ${records.length} snow route records\n`);

  // Clear existing data
  console.log('🗑️  Clearing any existing snow routes...');
  await supabase.from('snow_routes').delete().neq('id', 0);
  console.log('✓ Ready for fresh import\n');

  // Insert in batches
  const BATCH_SIZE = 20; // Smaller batches for geometry data
  let successCount = 0;

  console.log('📤 Importing routes...\n');

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    process.stdout.write(`  Batch ${batchNumber}/${totalBatches} (${batch.length} routes)... `);

    const insertData = batch.map(record => ({
      object_id: parseInt(record.OBJECTID) || null,
      on_street: record.ON_STREET || '',
      from_street: record.FROM_STREE || '',
      to_street: record.TO_STREET || '',
      restrict_type: record.RESTRICT_T || '',
      shape_length: parseFloat(record.SHAPE_LEN) || null,
      geom: record.the_geom || null
    }));

    const { data, error } = await supabase
      .from('snow_routes')
      .insert(insertData)
      .select();

    if (error) {
      console.log(`❌ FAILED`);
      console.error(`    Error: ${error.message}`);
    } else {
      console.log(`✓ ${data.length} routes`);
      successCount += data.length;
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total CSV records: ${records.length}`);
  console.log(`Successfully imported: ${successCount}`);
  console.log(`Failed: ${records.length - successCount}`);
  console.log('='.repeat(70));

  // Verify
  const { count, error: countError } = await supabase
    .from('snow_routes')
    .select('*', { count: 'exact', head: true });

  if (!countError) {
    console.log(`\n✅ Verification: ${count} routes now in database\n`);

    // Show samples
    const { data: samples } = await supabase
      .from('snow_routes')
      .select('on_street, from_street, to_street')
      .order('on_street')
      .limit(10);

    if (samples?.length) {
      console.log('📍 Sample snow ban streets:');
      samples.forEach((route, idx) => {
        console.log(`   ${idx + 1}. ${route.on_street} (${route.from_street} → ${route.to_street})`);
      });
    }
  }

  console.log('\n✅ Setup complete! Snow route data is ready.');
  console.log('\nNext steps:');
  console.log('  1. Build address matching logic');
  console.log('  2. Create forecast & confirmation notifications');
  console.log('  3. Test the system\n');
}
