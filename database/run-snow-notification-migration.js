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
  console.log('🔧 Adding snow notification columns...\n');

  const sqlPath = path.join(__dirname, 'add-snow-notification-columns.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  console.log('📝 SQL to execute:');
  console.log(sql);
  console.log('\n⚠️  MANUAL STEP REQUIRED:');
  console.log('\n1. Go to your Supabase Dashboard → SQL Editor');
  console.log('2. Copy the SQL above');
  console.log('3. Execute it to add the new columns\n');
  console.log('Or run this in psql:');
  console.log(`psql $DATABASE_URL < ${sqlPath}\n`);
}

runMigration().catch(console.error);
