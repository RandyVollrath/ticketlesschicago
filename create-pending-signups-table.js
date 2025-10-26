const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTable() {
  console.log('Creating pending_signups table...\n');

  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      -- Create pending_signups table to store form data before authentication
      CREATE TABLE IF NOT EXISTS pending_signups (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        license_plate TEXT,
        address TEXT,
        zip TEXT,
        vin TEXT,
        make TEXT,
        model TEXT,
        city_sticker TEXT,
        token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
      );

      -- Create index on email for fast lookups
      CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(email);

      -- Create index on expires_at for cleanup
      CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at);
    `
  });

  if (error) {
    console.error('❌ Error:', error.message);
    console.log('\nTrying direct SQL execution...\n');

    // Try using a raw SQL query instead
    const queries = [
      `CREATE TABLE IF NOT EXISTS pending_signups (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        license_plate TEXT,
        address TEXT,
        zip TEXT,
        vin TEXT,
        make TEXT,
        model TEXT,
        city_sticker TEXT,
        token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(email)`,
      `CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at)`
    ];

    console.log('Please run these SQL commands in Supabase SQL Editor:\n');
    console.log(queries.join(';\n\n') + ';');

  } else {
    console.log('✅ Table created successfully!');
  }
}

createTable();
