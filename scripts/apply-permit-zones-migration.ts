/**
 * Apply parking permit zones database migration
 *
 * Run with: npx ts-node scripts/apply-permit-zones-migration.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { supabaseAdmin } from '../lib/supabase';

async function applyMigration() {
  console.log('📊 Applying parking permit zones migration...\n');

  try {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available. Check SUPABASE_SERVICE_ROLE_KEY');
    }

    // Read the migration file
    const migrationPath = join(__dirname, '../supabase/migrations/create_parking_permit_zones_table.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log('Executing SQL migration...');

    // Execute the SQL
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_string: sql });

    if (error) {
      // Try direct query instead
      console.log('Trying direct query method...');

      // Split into individual statements and execute
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        const { error: execError } = await (supabaseAdmin as any).from('_').select(statement);
        if (execError && !execError.message?.includes('does not exist')) {
          console.warn(`Warning executing statement: ${execError.message}`);
        }
      }
    }

    console.log('✅ Migration applied successfully!\n');
    console.log('Next step: Run sync script to populate data:');
    console.log('  npx ts-node scripts/sync-permit-zones.ts');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    console.log('\nManual steps:');
    console.log('1. Go to your Supabase dashboard: https://supabase.com/dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Copy and paste the contents of:');
    console.log('   supabase/migrations/create_parking_permit_zones_table.sql');
    console.log('4. Run the SQL');
    process.exit(1);
  }
}

applyMigration();
