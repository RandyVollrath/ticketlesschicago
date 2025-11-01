const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTable() {
  const sql = fs.readFileSync('database/create-sd-street-sweeping-table.sql', 'utf-8');

  // Execute via RPC (Supabase doesn't support DDL directly, need to use raw SQL)
  console.log('Creating San Diego street sweeping table...');

  // Split by semicolon and execute each statement
  const statements = sql.split(';').filter(s => s.trim());

  for (const statement of statements) {
    if (!statement.trim()) continue;

    try {
      const { data, error } = await supabase.rpc('exec_sql', { sql_query: statement });
      if (error) {
        console.log('Statement:', statement.substring(0, 100) + '...');
        console.error('Error:', error);
      } else {
        console.log('✓ Executed statement');
      }
    } catch (err) {
      console.error('Failed to execute:', err);
    }
  }

  console.log('\n✅ Table creation complete!');
}

createTable().catch(console.error);
