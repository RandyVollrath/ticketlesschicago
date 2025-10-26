const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('🚀 Running snow_routes table migration...\n');

  const sqlPath = path.join(__dirname, 'create-snow-routes-table.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  console.log('📝 Executing SQL...');

  // Execute the SQL using Supabase's SQL API
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n💡 Note: You may need to run this SQL manually in the Supabase SQL Editor:');
    console.log('\nGo to: Supabase Dashboard → SQL Editor → New Query');
    console.log('\nPaste the contents of: database/create-snow-routes-table.sql');
    console.log('\nOr run:');
    console.log('psql $DATABASE_URL < database/create-snow-routes-table.sql');
    process.exit(1);
  }

  console.log('✅ Migration completed successfully!');
  console.log('\nYou can now run the import script:');
  console.log('node database/import-snow-routes.js Snow_Route_Parking_Restrictions_20251024.csv');
}

runMigration().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
