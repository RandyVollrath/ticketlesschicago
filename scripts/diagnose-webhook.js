#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function diagnose() {
  const email = 'mystreetcleaning+1@gmail.com';

  console.log('🔍 DIAGNOSING:', email);
  console.log('');

  const { data: { users } } = await supabase.auth.admin.listUsers();
  const authUser = users.find(u => u.email === email);

  if (!authUser) {
    console.log('❌ NO AUTH USER - webhook never ran!');
    
    const sessions = await stripe.checkout.sessions.list({ limit: 30 });
    const session = sessions.data.find(s => s.customer_details?.email === email);

    if (session) {
      console.log('💰 PAYMENT FOUND but NO ACCOUNT!');
      console.log('Session:', session.id);
      console.log('Metadata:', JSON.stringify(session.metadata, null, 2));
    }
    return;
  }

  console.log('✅ Auth user:', authUser.id);
  console.log('Created:', authUser.created_at);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('has_protection, stripe_customer_id, is_paid, first_name, street_address')
    .eq('user_id', authUser.id)
    .single();

  if (!profile) {
    console.log('❌ NO PROFILE - webhook failed at profile creation!');
    return;
  }

  console.log('✅ Profile exists');
  console.log('  has_protection:', profile.has_protection);
  console.log('  stripe_customer_id:', profile.stripe_customer_id || 'NULL');
  console.log('  street_address:', profile.street_address || 'NULL');

  const { data: consents } = await supabase
    .from('user_consents')
    .select('id')
    .eq('user_id', authUser.id);

  console.log('Consents:', consents?.length || 0);

  if ((consents?.length || 0) > 0) {
    console.log('');
    console.log('✅ Webhook completed');
    console.log('❌ BUT EMAIL NOT SENT - check webhook logs!');
  } else {
    console.log('❌ Webhook incomplete - consent step failed');
  }
}

diagnose().catch(console.error);
