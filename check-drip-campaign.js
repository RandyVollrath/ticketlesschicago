require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDripCampaign() {
  console.log('🔍 Checking drip campaign status...\n');

  // Get all drip campaign records
  const { data: dripRecords, error: dripError } = await supabase
    .from('drip_campaign_status')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (dripError) {
    console.error('❌ Error fetching drip campaign records:', dripError);
    return;
  }

  console.log(`Found ${dripRecords?.length || 0} drip campaign records:\n`);

  if (dripRecords && dripRecords.length > 0) {
    dripRecords.forEach(record => {
      console.log('📧 Email:', record.email);
      console.log('   User ID:', record.user_id);
      console.log('   Welcome sent:', record.welcome_sent);
      console.log('   Welcome sent at:', record.welcome_sent_at || 'Not sent');
      console.log('   Unsubscribed:', record.unsubscribed);
      console.log('   Created at:', record.created_at);
      console.log('');
    });
  }

  // Get recent user profiles with marketing consent
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('user_id, email, first_name, marketing_consent, created_at')
    .eq('marketing_consent', true)
    .order('created_at', { ascending: false })
    .limit(10);

  if (profilesError) {
    console.error('❌ Error fetching profiles:', profilesError);
    return;
  }

  console.log(`\n📊 Found ${profiles?.length || 0} users with marketing_consent=true:\n`);

  if (profiles && profiles.length > 0) {
    for (const profile of profiles) {
      console.log('👤 Email:', profile.email);
      console.log('   User ID:', profile.user_id);
      console.log('   First name:', profile.first_name);
      console.log('   Created:', profile.created_at);

      // Check if they have a drip campaign record
      const hasDripRecord = dripRecords?.find(r => r.user_id === profile.user_id);
      console.log('   Has drip record:', !!hasDripRecord ? '✅ Yes' : '❌ NO');
      console.log('');
    }
  }
}

checkDripCampaign()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
