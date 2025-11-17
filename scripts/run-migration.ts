/**
 * Migration runner for message_audit_log table
 *
 * Usage: npx ts-node scripts/run-migration.ts
 */

import { supabaseAdmin } from '../lib/supabase';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  try {
    console.log('📋 Running message_audit_log migration...\n');

    // Read the SQL file
    const sqlFilePath = path.join(__dirname, '../database/migrations/create_message_audit_log.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf-8');

    console.log('SQL to execute:');
    console.log('─'.repeat(80));
    console.log(sql);
    console.log('─'.repeat(80));
    console.log('');

    // Execute the migration
    console.log('🚀 Executing migration...');
    const { data, error } = await supabaseAdmin.rpc('exec_sql', { sql_string: sql });

    if (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }

    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('Verifying table exists...');

    // Verify the table was created
    const { data: tables, error: verifyError } = await supabaseAdmin
      .from('message_audit_log')
      .select('*')
      .limit(1);

    if (verifyError) {
      console.error('❌ Verification failed:', verifyError);
      console.log('');
      console.log('⚠️  Table may have been created but is not accessible via PostgREST.');
      console.log('You may need to grant permissions or check RLS policies.');
    } else {
      console.log('✅ Table verified! message_audit_log is ready to use.');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

runMigration();
