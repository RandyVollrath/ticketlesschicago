const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
  console.log('Adding marketing_consent column to user_profiles table...');

  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false;

      COMMENT ON COLUMN user_profiles.marketing_consent IS 'User consent to receive marketing emails about new ticket-prevention services (CAN-SPAM compliant)';
    `
  });

  if (error) {
    console.error('Migration failed:', error);

    // Try direct query instead
    console.log('Trying alternative method...');
    const { error: error2 } = await supabase
      .from('user_profiles')
      .select('marketing_consent')
      .limit(1);

    if (error2 && error2.message.includes('does not exist')) {
      console.error('Column does not exist and cannot be added via RPC.');
      console.log('\nPlease run this SQL manually in Supabase SQL Editor:');
      console.log('---');
      console.log('ALTER TABLE user_profiles');
      console.log('ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false;');
      console.log('---');
    } else if (!error2) {
      console.log('✅ Column already exists!');
    }
  } else {
    console.log('✅ Migration successful!');
  }
}

runMigration().catch(console.error);
