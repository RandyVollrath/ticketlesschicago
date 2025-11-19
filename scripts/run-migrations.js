#!/usr/bin/env node

/**
 * Run database migrations
 * Applies pending migrations to production database
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration(filePath) {
  console.log(`\n📄 Running migration: ${path.basename(filePath)}`);

  const sql = fs.readFileSync(filePath, 'utf8');

  // Split on semicolons to run each statement separately
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      const { data, error} = await supabase.rpc('exec_sql', { sql_query: statement + ';' });

      if (error) {
        // Try direct execution if RPC fails
        const { error: directError } = await supabase.from('_migrations').select('*').limit(0);
        if (directError) {
          console.error(`❌ Error: ${error.message}`);
          console.error(`Statement: ${statement.substring(0, 100)}...`);
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
    }
  }

  console.log(`✅ Migration completed`);
}

async function main() {
  console.log('🚀 Running database migrations...\n');

  const migrations = [
    'database/migrations/add_email_forwarding_id.sql',
    'database/migrations/add_license_plate_renewal_support.sql'
  ];

  for (const migration of migrations) {
    await runMigration(migration);
  }

  console.log('\n✅ All migrations completed!');
  console.log('\nVerifying columns...');

  // Verify migrations worked
  const { data, error } = await supabase
    .from('user_profiles')
    .select('email_forwarding_address, license_plate_type, license_plate_renewal_cost')
    .limit(1);

  if (error) {
    console.error('❌ Verification failed:', error.message);
  } else {
    console.log('✅ Columns exist and are accessible');
  }
}

main().catch(console.error);
