require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyForeignKey() {
  console.log('🔧 Attempting to add foreign key relationship via Supabase API...\n');

  // Unfortunately, Supabase client doesn't support DDL operations directly
  // We need to use the REST API or dashboard

  console.log('⚠️  Cannot execute DDL via Supabase JS client.');
  console.log('\n📋 Please run this SQL in your Supabase Dashboard SQL Editor:');
  console.log('\n---BEGIN SQL---');
  console.log(`
-- Add foreign key relationship
ALTER TABLE drip_campaign_status
ADD CONSTRAINT drip_campaign_status_user_id_fkey
FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
ON DELETE CASCADE;

-- Create index for faster joins
CREATE INDEX IF NOT EXISTS drip_campaign_status_user_id_idx
ON drip_campaign_status(user_id);
  `.trim());
  console.log('\n---END SQL---\n');

  console.log('📝 Steps:');
  console.log('1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/sql');
  console.log('2. Paste the SQL above');
  console.log('3. Click "Run"');
  console.log('4. Come back here and run: curl -L "https://www.autopilotamerica.com/api/drip/send-emails" -H "Authorization: Bearer 4c172831a589e4306eb3edb56d5351e40afb6761f3d57b5e04c068920e3ed372"\n');
}

applyForeignKey()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
