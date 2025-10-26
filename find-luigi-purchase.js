const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function findPurchase() {
  const email = 'countluigivampa@gmail.com';

  console.log('Checking user_consents for Protection purchase...');
  const { data: consents } = await supabaseAdmin
    .from('user_consents')
    .select('*')
    .eq('user_id', '4bf55942-4c71-4ba9-80ee-c89b7e384fdb');

  console.log('Consents found:', consents?.length || 0);
  if (consents?.length) {
    consents.forEach(c => {
      console.log('\nConsent:');
      console.log('  Type:', c.consent_type);
      console.log('  Granted:', c.consent_granted);
      console.log('  Stripe Session:', c.stripe_session_id);
      console.log('  Metadata:', JSON.stringify(c.metadata, null, 2));
      console.log('  Created:', c.created_at);
    });
  }
}

findPurchase().catch(console.error);
