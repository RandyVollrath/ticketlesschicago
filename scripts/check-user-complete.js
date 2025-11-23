#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const email = process.argv[2] || 'mystreetcleaning+5@gmail.com';

  console.log('Checking:', email);
  console.log('');

  // Get auth user
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('✅ User ID:', userId);
  console.log('');

  // Get profile
  const { data: profile } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single();
  console.log('Profile:');
  console.log('  has_protection:', profile.has_protection ? '✅ true' : '❌ false');
  console.log('  stripe_customer_id:', profile.stripe_customer_id ? '✅ ' + profile.stripe_customer_id : '❌ NOT SET');
  console.log('  email:', profile.email);
  console.log('');

  // Get consents
  const { data: consents } = await supabase.from('user_consents').select('*').eq('user_id', userId);
  console.log('Consents:', consents ? consents.length : 0);
  if (consents && consents.length > 0) {
    console.log('  ✅ Consent created!');
    consents.forEach(c => console.log('    - Type:', c.consent_type, '| Granted:', c.consented));
  } else {
    console.log('  ❌ NO CONSENTS CREATED');
  }
  console.log('');

  // Get audit logs
  const { data: audits } = await supabase.from('audit_logs').select('*').eq('user_id', userId);
  console.log('Audit Logs:', audits ? audits.length : 0);
  if (audits && audits.length > 0) {
    console.log('  ✅ Audit log created!');
    audits.forEach(a => console.log('    - Action:', a.action_type, '| Status:', a.status));
  } else {
    console.log('  ❌ NO AUDIT LOGS');
  }

  console.log('');
  console.log('===================');
  console.log('SUMMARY:');
  console.log('  Profile:', profile.has_protection && profile.stripe_customer_id ? '✅' : '❌');
  console.log('  Email sent:', '✅ (user reported receiving it)');
  console.log('  Consents:', consents && consents.length > 0 ? '✅' : '❌');
  console.log('  Audit logs:', audits && audits.length > 0 ? '✅' : '❌');
  console.log('===================');
}

check().catch(console.error);
