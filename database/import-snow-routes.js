const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function importSnowRoutes() {
  console.log('📥 Starting snow routes import...\n');

  // Read CSV file
  const csvPath = path.join(__dirname, '../', process.argv[2] || 'Snow_Route_Parking_Restrictions_20251024.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`📄 Reading CSV file: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  // Parse CSV
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`✓ Parsed ${records.length} records\n`);

  // Clear existing data
  console.log('🗑️  Clearing existing snow routes...');
  const { error: deleteError } = await supabase
    .from('snow_routes')
    .delete()
    .neq('id', 0); // Delete all

  if (deleteError && deleteError.code !== 'PGRST116') { // Ignore "no rows found"
    console.error('Error clearing data:', deleteError);
  } else {
    console.log('✓ Existing data cleared\n');
  }

  // Insert records in batches
  const BATCH_SIZE = 50;
  let successCount = 0;
  let errorCount = 0;

  console.log('📤 Importing routes in batches...\n');

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} routes)...`);

    const insertData = batch.map(record => {
      // Parse the MULTILINESTRING geometry from WKT format
      // The geometry is already in WKT format, we'll store it and let PostGIS handle it
      return {
        object_id: parseInt(record.OBJECTID) || null,
        on_street: record.ON_STREET || '',
        from_street: record.FROM_STREE || '',
        to_street: record.TO_STREET || '',
        restrict_type: record.RESTRICT_T || '',
        shape_length: parseFloat(record.SHAPE_LEN) || null,
        // Store geometry as WKT - PostGIS will convert it
        geom: record.the_geom || null
      };
    });

    const { data, error } = await supabase
      .from('snow_routes')
      .insert(insertData)
      .select();

    if (error) {
      console.error(`  ❌ Batch ${batchNumber} failed:`, error.message);
      errorCount += batch.length;
    } else {
      console.log(`  ✓ Batch ${batchNumber} inserted (${data.length} routes)`);
      successCount += data.length;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Import Summary:');
  console.log('='.repeat(60));
  console.log(`Total records processed: ${records.length}`);
  console.log(`✓ Successfully imported: ${successCount}`);
  console.log(`❌ Failed: ${errorCount}`);
  console.log('='.repeat(60));

  if (successCount > 0) {
    // Verify the import
    const { count } = await supabase
      .from('snow_routes')
      .select('*', { count: 'exact', head: true });

    console.log(`\n✅ Verification: ${count} routes now in database`);

    // Show sample routes
    const { data: samples } = await supabase
      .from('snow_routes')
      .select('on_street, from_street, to_street')
      .limit(5);

    console.log('\n📍 Sample routes:');
    samples?.forEach(route => {
      console.log(`  - ${route.on_street} (${route.from_street} to ${route.to_street})`);
    });
  }

  console.log('\n✅ Import complete!');
}

importSnowRoutes().catch(error => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});
