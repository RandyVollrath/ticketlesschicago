const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDripStatus() {
  console.log('🔍 Checking drip campaign status for countluigivampa users...\n');

  // Find all countluigivampa users
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, email, first_name, marketing_consent, created_at')
    .ilike('email', 'countluigivampa%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (profileError) {
    console.error('Error fetching profiles:', profileError);
    return;
  }

  console.log(`Found ${profiles.length} countluigivampa users:\n`);

  for (const profile of profiles) {
    console.log(`📧 ${profile.email}`);
    console.log(`   User ID: ${profile.user_id}`);
    console.log(`   Name: ${profile.first_name}`);
    console.log(`   Marketing Consent: ${profile.marketing_consent}`);
    console.log(`   Created: ${profile.created_at}`);

    // Check drip campaign status
    const { data: drip, error: dripError } = await supabase
      .from('drip_campaign_status')
      .select('*')
      .eq('user_id', profile.user_id)
      .single();

    if (dripError) {
      console.log(`   ❌ Drip Status: NOT FOUND - ${dripError.message}`);
    } else {
      console.log(`   ✅ Drip Status Found:`);
      console.log(`      - Welcome Sent: ${drip.welcome_sent} ${drip.welcome_sent_at ? `(${drip.welcome_sent_at})` : ''}`);
      console.log(`      - Proof Sent: ${drip.proof_sent}`);
      console.log(`      - Soft Sell Sent: ${drip.soft_sell_sent}`);
      console.log(`      - Unsubscribed: ${drip.unsubscribed}`);
    }

    console.log('');
  }
}

checkDripStatus()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
