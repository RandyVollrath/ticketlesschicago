#!/usr/bin/env node
/**
 * Copy all data from MSC to TicketlessAmerica
 * Since MSC import worked perfectly, just replicate it
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function copyData() {
  console.log('🔄 Copying data from MSC to TicketlessAmerica\n');

  // Step 1: Export all from MSC
  console.log('📥 Exporting from MSC database...');
  let allData = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('❌ Export error:', error.message);
      throw error;
    }

    if (!data || data.length === 0) break;

    allData = allData.concat(data);
    console.log(`  Exported: ${allData.length} rows...`);

    if (data.length < pageSize) break;
    page++;
  }

  console.log(`✅ Exported ${allData.length} total rows from MSC\n`);

  // Step 2: Clear TicketlessAmerica
  console.log('🗑️  Clearing TicketlessAmerica database...');
  const { error: deleteError } = await taSupabase
    .from('street_cleaning_schedule')
    .delete()
    .neq('ward', 'IMPOSSIBLE');

  if (deleteError) {
    console.error('❌ Delete error:', deleteError.message);
    throw deleteError;
  }

  const { count: afterDelete } = await taSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Cleared. Remaining: ${afterDelete || 0}\n`);

  // Step 3: Import to TicketlessAmerica
  console.log('📤 Importing to TicketlessAmerica...');
  const batchSize = 100; // Smaller batches for safety
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < allData.length; i += batchSize) {
    const batch = allData.slice(i, i + batchSize);

    // Remove id field to let DB generate new IDs
    const cleanBatch = batch.map(row => {
      const { id, ...rest } = row;
      return rest;
    });

    const { error: insertError } = await taSupabase
      .from('street_cleaning_schedule')
      .insert(cleanBatch);

    if (insertError) {
      console.log(`\n  ⚠️  Batch ${Math.floor(i / batchSize) + 1} failed:`, insertError.message);
      failed += batch.length;
    } else {
      inserted += batch.length;
    }

    process.stdout.write(`\r  Progress: ${inserted}/${allData.length} (${failed} failed)`);
  }

  console.log('\n');

  // Step 4: Verify
  const { count: finalCount } = await taSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ TicketlessAmerica: ${finalCount} rows imported`);

  // Verify geometry
  const { data: withGeom } = await taSupabase
    .from('street_cleaning_schedule')
    .select('ward, section')
    .not('geom_simplified', 'is', null)
    .limit(1);

  if (withGeom && withGeom.length > 0) {
    console.log('✅ Geometry verified!\n');
  } else {
    console.log('⚠️  Warning: No geometry found\n');
  }

  if (finalCount === allData.length && failed === 0) {
    console.log('🎉 SUCCESS! Perfect copy from MSC to TicketlessAmerica');
    console.log('\nNow running date fix for both databases...\n');

    // Run date fix
    const { spawn } = require('child_process');
    const updateProcess = spawn('node', ['scripts/update-dates-after-import.js'], {
      stdio: 'inherit'
    });

    updateProcess.on('close', (code) => {
      if (code === 0) {
        console.log('\n🎉 ALL DONE! Both databases have geometry + correct dates');
      }
    });
  } else {
    console.log(`⚠️  Some rows failed. Expected ${allData.length}, got ${finalCount}`);
  }
}

copyData().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});