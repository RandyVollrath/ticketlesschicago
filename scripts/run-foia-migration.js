#!/usr/bin/env node

/**
 * Run the FOIA database migration
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials');
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  const migrationPath = path.join(__dirname, '../database/migrations/create_foia_contested_tickets.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Running FOIA database migration...');
  console.log(`File: ${migrationPath}\n`);

  // Split by semicolons and execute each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i] + ';';

    // Skip comments
    if (statement.trim().startsWith('--')) continue;

    try {
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

      if (error) {
        // Try direct execution for some statements that don't work with RPC
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ sql_query: statement })
        });

        if (!response.ok) {
          console.error(`Error in statement ${i + 1}:`, error.message || await response.text());
          errorCount++;
        } else {
          successCount++;
        }
      } else {
        successCount++;
      }
    } catch (e) {
      console.error(`Exception in statement ${i + 1}:`, e.message);
      errorCount++;
    }
  }

  console.log(`\nMigration complete!`);
  console.log(`Successful: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  if (errorCount === 0) {
    console.log('\n✓ All statements executed successfully!');
  }
}

runMigration().catch(console.error);
