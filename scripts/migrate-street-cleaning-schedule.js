#!/usr/bin/env node
/**
 * Migrates street cleaning schedule from MyStreetCleaning database to TicketlessAmerica
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Source: MyStreetCleaning database
const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

// Destination: TicketlessAmerica database
const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateSchedule() {
  console.log('🚀 Starting street cleaning schedule migration...\n');

  try {
    // Step 1: Fetch all rows from MSC database
    console.log('📥 Fetching schedule from MyStreetCleaning database...');
    const { data: mscSchedule, error: fetchError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('*')
      .order('cleaning_date', { ascending: true });

    if (fetchError) {
      console.error('❌ Error fetching from MSC database:', fetchError);
      process.exit(1);
    }

    console.log(`✅ Fetched ${mscSchedule.length} rows from MSC database\n`);

    if (mscSchedule.length === 0) {
      console.log('⚠️  No data to migrate');
      process.exit(0);
    }

    // Show sample of what we're migrating
    console.log('📊 Sample data:');
    console.log(mscSchedule.slice(0, 3).map(row => ({
      ward: row.ward,
      section: row.section,
      cleaning_date: row.cleaning_date
    })));
    console.log('...\n');

    // Step 2: Clear existing data in TicketlessAmerica database
    console.log('🗑️  Clearing existing schedule in TicketlessAmerica database...');
    const { error: deleteError } = await taSupabase
      .from('street_cleaning_schedule')
      .delete()
      .neq('ward', 'PLACEHOLDER_THAT_WONT_MATCH'); // Delete all rows

    if (deleteError && deleteError.code !== 'PGRST116') { // PGRST116 = no rows found, which is fine
      console.error('❌ Error clearing existing data:', deleteError);
      process.exit(1);
    }

    console.log('✅ Cleared existing data\n');

    // Step 3: Insert data in batches (Supabase has a limit)
    const batchSize = 500;
    let insertedCount = 0;
    let failedCount = 0;

    console.log('📤 Inserting schedule into TicketlessAmerica database...');

    for (let i = 0; i < mscSchedule.length; i += batchSize) {
      const batch = mscSchedule.slice(i, i + batchSize);

      const { error: insertError, count } = await taSupabase
        .from('street_cleaning_schedule')
        .insert(batch)
        .select();

      if (insertError) {
        console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, insertError);
        failedCount += batch.length;
      } else {
        insertedCount += batch.length;
        console.log(`✅ Inserted batch ${i / batchSize + 1}: ${batch.length} rows`);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   Total rows in source: ${mscSchedule.length}`);
    console.log(`   Successfully inserted: ${insertedCount}`);
    console.log(`   Failed: ${failedCount}`);

    if (failedCount > 0) {
      console.log('\n⚠️  WARNING: Some rows failed to migrate!');
      process.exit(1);
    }

    // Step 4: Verify the migration
    console.log('\n🔍 Verifying migration...');
    const { count: verifyCount, error: verifyError } = await taSupabase
      .from('street_cleaning_schedule')
      .select('*', { count: 'exact', head: true });

    if (verifyError) {
      console.error('❌ Error verifying migration:', verifyError);
      process.exit(1);
    }

    console.log(`✅ Verified: ${verifyCount} rows in TicketlessAmerica database`);

    if (verifyCount === mscSchedule.length) {
      console.log('\n🎉 Migration completed successfully!');
    } else {
      console.log(`\n⚠️  WARNING: Row count mismatch! Expected ${mscSchedule.length}, got ${verifyCount}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

migrateSchedule();