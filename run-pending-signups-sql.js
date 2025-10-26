const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTable() {
  console.log('🚀 Creating pending_signups table...\n');

  try {
    // Try to insert a test row to see if table exists
    const { error: testError } = await supabase
      .from('pending_signups')
      .select('id')
      .limit(1);

    if (!testError) {
      console.log('✅ Table already exists!');
      return;
    }

    console.log('⚠️  Table does not exist. Creating via SQL...\n');

    // Since we can't execute raw SQL via the client, provide instructions
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 PLEASE RUN THIS SQL IN SUPABASE SQL EDITOR:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const sql = `
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

-- Enable RLS
ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything
CREATE POLICY "Service role has full access to pending_signups" ON pending_signups
  FOR ALL USING (true);

COMMENT ON TABLE pending_signups IS 'Temporary storage for signup form data before user authenticates';
`;

    console.log(sql);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📌 Steps:');
    console.log('1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new');
    console.log('2. Copy the SQL above');
    console.log('3. Paste and run it');
    console.log('4. Run this script again to verify\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createTable();
