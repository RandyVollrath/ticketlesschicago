#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTables() {
  console.log('🔨 Creating tables directly via API...\n');

  // Read the SQL file
  const fs = require('fs');
  const path = require('path');

  const sqlFiles = [
    'database/migrations/create_ticket_contests.sql',
    'database/migrations/create_court_records_and_attorneys.sql'
  ];

  for (const sqlFile of sqlFiles) {
    console.log(`📄 Processing ${sqlFile}...`);

    const sqlPath = path.join(__dirname, sqlFile);
    if (!fs.existsSync(sqlPath)) {
      console.log(`   ❌ File not found: ${sqlPath}`);
      continue;
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Try to execute via RPC
    const { data, error } = await supabase.rpc('exec_sql', { query: sql });

    if (error) {
      console.log(`   ⚠️  RPC exec_sql not available (this is normal)`);
      console.log(`   💡 You need to run this SQL manually in Supabase SQL Editor`);
      console.log(`   📍 Go to: https://supabase.com/dashboard/project/${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]}/sql`);
      console.log('');
      break;
    } else {
      console.log(`   ✅ Success!`);
    }
  }

  console.log('\n📋 MANUAL STEPS REQUIRED:\n');
  console.log('Since we can\'t create tables via API, please:');
  console.log('');
  console.log('1. Open Supabase Dashboard → SQL Editor');
  console.log('2. Click "New query"');
  console.log('3. Copy ENTIRE contents of: database/migrations/create_ticket_contests.sql');
  console.log('4. Paste and click "Run"');
  console.log('5. Check for any RED error messages at bottom');
  console.log('6. Repeat for: database/migrations/create_court_records_and_attorneys.sql');
  console.log('7. Run: node check-tables.js to verify');
  console.log('');
  console.log('⚠️  IMPORTANT: Look for error messages! Common issues:');
  console.log('   - RLS policies referencing tables that don\'t exist yet');
  console.log('   - Foreign key constraints on missing tables');
  console.log('   - Insufficient permissions');
  console.log('');
  console.log('If you see errors, send them to me and I\'ll fix the SQL!');
}

createTables().catch(console.error);
