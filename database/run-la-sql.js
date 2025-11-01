const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runSQL() {
  console.log('📖 Reading SQL file...');
  const sql = fs.readFileSync('database/create-la-street-sweeping-table.sql', 'utf8');

  console.log('🔄 Executing SQL...');

  // Split by semicolon and execute each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    console.log(`Executing: ${statement.substring(0, 60)}...`);

    const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

    if (error) {
      // Try direct query if RPC doesn't work
      const { error: directError } = await supabase.from('_sql').select('*').limit(0);

      if (directError) {
        console.error('❌ Error executing SQL:', error);
        console.log('Trying alternative method...');

        // For CREATE TABLE, we need to use Supabase's SQL editor or do it manually
        console.log('⚠️  Please run this SQL manually in Supabase SQL Editor:');
        console.log(sql);
        process.exit(1);
      }
    } else {
      console.log('✅ Statement executed successfully');
    }
  }

  console.log('🎉 SQL execution complete!');
}

runSQL()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
