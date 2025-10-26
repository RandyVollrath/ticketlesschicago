#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTables() {
  console.log('🔍 Checking which tables exist...\n');

  const tablesToCheck = [
    'ticket_contests',
    'court_case_outcomes',
    'win_rate_statistics',
    'attorneys',
    'attorney_case_expertise',
    'attorney_reviews',
    'attorney_quote_requests'
  ];

  for (const table of tablesToCheck) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      if (error.message.includes('does not exist') || error.message.includes('not found') || error.message.includes('schema cache')) {
        console.log(`❌ ${table} - DOES NOT EXIST`);
      } else {
        console.log(`⚠️  ${table} - ERROR: ${error.message}`);
      }
    } else {
      console.log(`✅ ${table} - EXISTS (${data?.length || 0} rows in preview)`);
    }
  }

  console.log('\n📋 Next Steps:');
  console.log('1. Go to Supabase Dashboard → SQL Editor');
  console.log('2. Run the SQL from database/migrations/create_court_records_and_attorneys.sql');
  console.log('3. Check for any error messages in red');
  console.log('4. Run this script again to verify');
}

checkTables().catch(console.error);
