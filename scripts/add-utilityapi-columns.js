// Add UtilityAPI columns to user_profiles table
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addColumns() {
  console.log('Adding UtilityAPI columns to user_profiles table...');

  const sql = `
    ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS utilityapi_form_uid TEXT,
    ADD COLUMN IF NOT EXISTS utilityapi_authorization_uid TEXT,
    ADD COLUMN IF NOT EXISTS utilityapi_connected BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS utilityapi_connected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS utilityapi_utility TEXT,
    ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_uid TEXT,
    ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_pdf_url TEXT,
    ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_date TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_user_profiles_utilityapi_auth
    ON user_profiles(utilityapi_authorization_uid);
  `;

  const { data, error } = await supabase.rpc('exec_sql', { query: sql });

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log('✅ Columns added successfully');
}

addColumns();
