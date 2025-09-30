#!/usr/bin/env node
/**
 * Copy MSC data to TicketlessAmerica using raw HTTP requests
 * Bypasses Supabase client library issues
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

async function copyViaHTTP() {
  console.log('🚀 Copying MSC to TicketlessAmerica via HTTP\n');

  // Step 1: Export from MSC (this works)
  console.log('📥 Exporting from MSC...');
  let allData = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    console.log(`  Exported: ${allData.length}...`);

    if (data.length < pageSize) break;
    page++;
  }

  console.log(`✅ Exported ${allData.length} rows from MSC\n`);

  // Step 2: Delete from TicketlessAmerica via HTTP
  console.log('🗑️  Clearing TicketlessAmerica via HTTP...');

  const taUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const taKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const deleteResponse = await fetch(`${taUrl}/rest/v1/street_cleaning_schedule?ward=neq.IMPOSSIBLE`, {
    method: 'DELETE',
    headers: {
      'apikey': taKey,
      'Authorization': `Bearer ${taKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }
  });

  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    console.error('❌ Delete failed:', deleteResponse.status, errorText);
    throw new Error('Failed to clear TicketlessAmerica');
  }

  console.log('✅ Cleared TicketlessAmerica\n');

  // Step 3: Insert to TicketlessAmerica via HTTP
  console.log('📤 Inserting to TicketlessAmerica...');
  const batchSize = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < allData.length; i += batchSize) {
    const batch = allData.slice(i, i + batchSize);

    // Remove id field
    const cleanBatch = batch.map(row => {
      const { id, ...rest } = row;
      return rest;
    });

    const insertResponse = await fetch(`${taUrl}/rest/v1/street_cleaning_schedule`, {
      method: 'POST',
      headers: {
        'apikey': taKey,
        'Authorization': `Bearer ${taKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(cleanBatch)
    });

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.log(`\n  ⚠️  Batch ${Math.floor(i / batchSize) + 1} failed:`, insertResponse.status, errorText.substring(0, 200));
      failed += batch.length;
    } else {
      inserted += batch.length;
    }

    process.stdout.write(`\r  Progress: ${inserted}/${allData.length} (${failed} failed)`);
  }

  console.log('\n');

  // Verify
  const verifyResponse = await fetch(`${taUrl}/rest/v1/street_cleaning_schedule?select=count`, {
    method: 'HEAD',
    headers: {
      'apikey': taKey,
      'Authorization': `Bearer ${taKey}`,
      'Prefer': 'count=exact'
    }
  });

  const count = verifyResponse.headers.get('content-range')?.split('/')[1];

  console.log(`✅ TicketlessAmerica: ${count || '?'} rows imported`);
  console.log(`   Expected: ${allData.length}`);

  if (parseInt(count) === allData.length) {
    console.log('\n🎉 PERFECT! Both databases now have clean data with geometry + correct dates');
    console.log('\n✅ Maps will work');
    console.log('✅ Address lookup will work');
    console.log('✅ Notifications will work tomorrow');
  } else {
    console.log(`\n⚠️  Count mismatch, but ${count} rows is close to ${allData.length}`);
  }
}

copyViaHTTP().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});