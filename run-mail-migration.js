// Run mail service database migration
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

async function runMigration() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('Running mail service migration...');

  const sql = fs.readFileSync(
    path.join(__dirname, 'database/migrations/add_mail_service_to_contests.sql'),
    'utf8'
  );

  // Split by semicolon and run each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    console.log('Executing:', statement.substring(0, 100) + '...');

    const { error } = await supabase.rpc('exec_sql', { sql: statement });

    if (error) {
      // Try direct query if RPC doesn't exist
      const { error: directError } = await supabase.from('_').select('*').limit(0);

      console.error('Migration error:', error);
      console.log('\nNote: Supabase free tier may not support direct SQL execution.');
      console.log('Please run this migration manually in your Supabase SQL editor:');
      console.log('\nhttps://supabase.com/dashboard/project/YOUR_PROJECT/editor\n');
      console.log('SQL to run:\n');
      console.log(sql);
      process.exit(1);
    }
  }

  console.log('✅ Migration complete!');
}

runMigration().catch(console.error);
