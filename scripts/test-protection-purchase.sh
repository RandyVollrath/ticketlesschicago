#!/bin/bash

# Quick Protection Purchase Test
# Run this after EVERY webhook deployment

echo "🧪 Protection Purchase Test"
echo ""
echo "MANUAL STEPS:"
echo "1. Go to https://autopilotamerica.com/protection"
echo "2. Use test email: test-$(date +%s)@gmail.com"
echo "3. Use test card: 4242 4242 4242 4242"
echo "4. Complete purchase"
echo ""
echo "After purchase completes, enter the email you used:"
read -p "Email: " email

echo ""
echo "Checking if purchase completed correctly..."
echo ""

node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const email = '$email';

  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users.find(u => u.email === email);

  if (!user) {
    console.log('❌ FAILED: User not created');
    process.exit(1);
  }

  const userId = user.id;

  const { data: profile } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single();

  if (!profile || !profile.has_protection || !profile.stripe_customer_id) {
    console.log('❌ FAILED: Profile incomplete');
    console.log('  has_protection:', profile?.has_protection);
    console.log('  stripe_customer_id:', profile?.stripe_customer_id);
    process.exit(1);
  }

  const { data: consents } = await supabase.from('user_consents').select('*').eq('user_id', userId);

  if (!consents || consents.length === 0) {
    console.log('❌ FAILED: No consents created');
    console.log('');
    console.log('🚨 WEBHOOK IS BROKEN - DO NOT DEPLOY');
    process.exit(1);
  }

  const { data: audits } = await supabase.from('audit_logs').select('*').eq('user_id', userId);

  if (!audits || audits.length === 0) {
    console.log('❌ FAILED: No audit logs');
    console.log('');
    console.log('🚨 WEBHOOK IS BROKEN - DO NOT DEPLOY');
    process.exit(1);
  }

  console.log('✅ PASSED: Profile created');
  console.log('✅ PASSED: Stripe customer ID saved');
  console.log('✅ PASSED: Consents created (' + consents.length + ')');
  console.log('✅ PASSED: Audit logs created (' + audits.length + ')');
  console.log('');
  console.log('🎉 Protection purchase flow is working correctly');
  console.log('');
  console.log('Safe to deploy to production.');
}

check().catch(err => {
  console.log('❌ FAILED:', err.message);
  process.exit(1);
});
"
