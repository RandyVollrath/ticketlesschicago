import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  console.log('Applying permit document fields migration...');

  // Check if columns already exist
  const { data: columns, error: checkError } = await supabase
    .from('user_profiles')
    .select('*')
    .limit(1);

  if (checkError) {
    console.error('Error checking table:', checkError);
    return;
  }

  // We'll use raw SQL via the admin API
  const sql = `
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS permit_requested BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS drivers_license_url TEXT,
      ADD COLUMN IF NOT EXISTS proof_of_residency_url TEXT,
      ADD COLUMN IF NOT EXISTS permit_zone_number TEXT,
      ADD COLUMN IF NOT EXISTS permit_application_status TEXT DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS home_address_full TEXT;
  `;

  console.log('SQL to execute:', sql);
  console.log('\nPlease run this SQL manually in your Supabase SQL editor:');
  console.log('https://supabase.com/dashboard/project/uodlprrbsaovqcqtgwrm/sql/new');
  console.log('\n' + sql);
}

applyMigration();
