require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixDripCampaign() {
  console.log('🔧 Fixing drip campaign records...\n');

  // Get all users with marketing consent who don't have drip records
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('user_id, email, first_name, marketing_consent')
    .eq('marketing_consent', true);

  if (profilesError) {
    console.error('❌ Error fetching profiles:', profilesError);
    return;
  }

  console.log(`Found ${profiles?.length || 0} users with marketing consent\n`);

  for (const profile of profiles || []) {
    console.log(`📧 Processing ${profile.email}...`);

    // Create drip campaign record
    const { data, error } = await supabase
      .from('drip_campaign_status')
      .upsert({
        user_id: profile.user_id,
        email: profile.email,
        campaign_name: 'free_alerts_onboarding',
        welcome_sent: false,
        proof_sent: false,
        soft_sell_sent: false,
        unsubscribed: false,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      })
      .select();

    if (error) {
      console.error(`   ❌ Error:`, error);
    } else {
      console.log(`   ✅ Drip campaign record created`);
    }
  }

  console.log('\n✅ Done! Drip campaign records created.');
}

fixDripCampaign()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
