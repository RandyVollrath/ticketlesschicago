const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigrations() {
  console.log('🚀 Running Option B database migrations...\n');

  const migrations = [
    'create-renewal-charges-table.sql',
    'add-renewal-tracking-fields.sql'
  ];

  for (const migration of migrations) {
    console.log(`📝 Running migration: ${migration}`);

    try {
      const sqlPath = path.join(__dirname, migration);
      const sql = fs.readFileSync(sqlPath, 'utf8');

      // Split by semicolon and run each statement separately
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement) {
          console.log(`  Executing statement ${i + 1}/${statements.length}...`);

          const { error } = await supabase.rpc('exec_sql', { sql: statement });

          if (error) {
            // Some operations might fail if already exists, check the error
            if (error.message.includes('already exists') || error.message.includes('duplicate')) {
              console.log(`  ⏭️  Skipped (already exists)`);
            } else {
              console.error(`  ❌ Error:`, error.message);
              throw error;
            }
          } else {
            console.log(`  ✅ Success`);
          }
        }
      }

      console.log(`✅ Completed: ${migration}\n`);
    } catch (error) {
      console.error(`❌ Failed to run ${migration}:`, error);
      console.log('\n⚠️  You may need to run these migrations manually in Supabase SQL Editor\n');

      // Print SQL for manual execution
      const sqlPath = path.join(__dirname, migration);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log('--- SQL to run manually ---');
      console.log(sql);
      console.log('---------------------------\n');
    }
  }

  console.log('🎉 All migrations completed!');
}

runMigrations().catch(console.error);
