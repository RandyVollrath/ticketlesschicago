require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function insertDripRecords() {
  console.log('🔧 Creating drip campaign records...\n');

  const users = [
    { user_id: '926ee150-2c47-4bcd-be14-4329cf81d1ae', email: 'hiautopilotamerica+1@gmail.com' },
    { user_id: '8ef5f0af-77cb-4cc6-9cf3-48defee5a482', email: 'hiautopilotamerica+2@gmail.com' }
  ];

  for (const user of users) {
    console.log(`📧 Creating record for ${user.email}...`);

    const { data, error } = await supabase
      .from('drip_campaign_status')
      .insert({
        user_id: user.user_id,
        email: user.email,
        campaign_name: 'free_alerts_onboarding'
      })
      .select();

    if (error) {
      console.error(`   ❌ Error:`, error);
    } else {
      console.log(`   ✅ Created:`, data);
    }
  }

  console.log('\n✅ Done!');
}

insertDripRecords()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
