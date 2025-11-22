#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testCountLuigiRenewal() {
  console.log('🧪 Testing Count Luigi Renewal\n');

  // Find Count Luigi account
  const { data: user, error: userError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'countluigivmpa@gmail.com')
    .single();

  if (userError || !user) {
    console.error('❌ Could not find countluigivmpa@gmail.com account');
    return;
  }

  console.log('✅ Found Count Luigi account:');
  console.log(`  Email: ${user.email}`);
  console.log(`  User ID: ${user.user_id}`);
  console.log(`  Stripe Customer: ${user.stripe_customer_id || 'NOT SET'}`);
  console.log(`  Has Protection: ${user.has_protection}`);
  console.log(`  City Sticker Expiry: ${user.city_sticker_expiry || 'NOT SET'}`);
  console.log(`  License Plate: ${user.license_plate || 'NOT SET'}`);
  console.log(`  Vehicle Type: ${user.vehicle_type || 'NOT SET'}\n`);

  if (!user.stripe_customer_id) {
    console.log('❌ No Stripe customer ID found!');
    console.log('This means the Protection signup did not complete successfully.');
    console.log('Please complete the Stripe checkout first.\n');
    return;
  }

  // Set expiry to 25 days from now
  const testExpiryDate = new Date();
  testExpiryDate.setDate(testExpiryDate.getDate() + 25);
  const testExpiryString = testExpiryDate.toISOString().split('T')[0];

  console.log(`📅 Setting city sticker expiry to: ${testExpiryString} (25 days from now)`);

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      city_sticker_expiry: testExpiryString,
      vehicle_type: user.vehicle_type || 'P',
      license_plate: user.license_plate || 'TEST456',
    })
    .eq('user_id', user.user_id);

  if (updateError) {
    console.error('Error updating user:', updateError);
    return;
  }

  console.log('✅ User updated!\n');

  console.log('📋 What Will Happen:');
  console.log('  1. Cron job finds this user (25 days until expiry)');
  console.log('  2. Charges via saved Stripe payment method');
  console.log('  3. Customer charged: ~$102.50 ($100 + $2.50 fees)');
  console.log('  4. Remitter receives: $100.00 (directly via transfer_data)');
  console.log('  5. Remitter receives: $12.00 (service fee from platform)');
  console.log('  6. Platform keeps: $2.50 (covers Stripe fees + infrastructure)');
  console.log('  7. Creates order in renewal_orders table');
  console.log('  8. Logs charge in renewal_charges table\n');

  console.log('🚀 Triggering cron job now...\n');
}

testCountLuigiRenewal().catch(console.error);
