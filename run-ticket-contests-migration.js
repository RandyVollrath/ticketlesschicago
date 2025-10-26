#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('🚀 Running ticket_contests table migration...\n');

  // Read the SQL file
  const sqlPath = path.join(__dirname, 'database/migrations/create_ticket_contests.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    // First check if table exists
    const { data: existingData, error: checkError } = await supabase
      .from('ticket_contests')
      .select('id')
      .limit(1);

    if (!checkError) {
      console.log('✅ ticket_contests table already exists!');
      console.log(`   Found ${existingData?.length || 0} records\n`);
      return;
    }

    console.log('📝 Table does not exist, creating now...\n');

    // Execute SQL using the REST API directly
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SQL execution failed: ${error}`);
    }

    console.log('✅ Migration completed successfully!\n');

    // Verify table was created
    const { data: verifyData, error: verifyError } = await supabase
      .from('ticket_contests')
      .select('id')
      .limit(1);

    if (verifyError) {
      console.log('⚠️  Warning: Could not verify table creation:', verifyError.message);
      console.log('\n📋 Please run this SQL manually in Supabase SQL Editor:\n');
      console.log(sql);
    } else {
      console.log('✅ Table verification successful!\n');
    }

  } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.log('\n📋 Please run this SQL manually in Supabase SQL Editor:\n');
    console.log('-----------------------------------------------------------');
    console.log(sql);
    console.log('-----------------------------------------------------------\n');
    process.exit(1);
  }
}

runMigration();
