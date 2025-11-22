#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testRenewalCron() {
  console.log('🧪 Testing Renewal Cron Job\n');

  // Step 1: Find Protection subscribers
  console.log('Step 1: Checking for Protection subscribers...');
  const { data: subscribers, error: subError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('has_protection', true);

  if (subError) {
    console.error('Error fetching subscribers:', subError);
    return;
  }

  console.log(`Found ${subscribers?.length || 0} Protection subscribers\n`);

  if (!subscribers || subscribers.length === 0) {
    console.log('❌ No Protection subscribers found. Cannot test renewal flow.');
    console.log('You need to complete a Protection signup first.');
    return;
  }

  // Show current subscribers
  subscribers.forEach((sub, i) => {
    console.log(`Subscriber ${i + 1}:`);
    console.log(`  Email: ${sub.email}`);
    console.log(`  User ID: ${sub.user_id}`);
    console.log(`  Stripe Customer: ${sub.stripe_customer_id || 'Not set'}`);
    console.log(`  City Sticker Expiry: ${sub.city_sticker_expiry || 'Not set'}`);
    console.log(`  License Plate: ${sub.license_plate || 'Not set'}`);
    console.log(`  Vehicle Type: ${sub.vehicle_type || 'Not set'}`);
    console.log('');
  });

  // Step 2: Check for active remitters
  console.log('Step 2: Checking for active remitters...');
  const { data: remitters, error: remError } = await supabase
    .from('renewal_partners')
    .select('*')
    .eq('status', 'active');

  if (remError) {
    console.error('Error fetching remitters:', remError);
    return;
  }

  console.log(`Found ${remitters?.length || 0} active remitters\n`);

  if (!remitters || remitters.length === 0) {
    console.log('❌ No active remitters found. Cannot process renewals.');
    console.log('You need to have a remitter with Stripe Connect set up.');
    return;
  }

  remitters.forEach((rem, i) => {
    console.log(`Remitter ${i + 1}:`);
    console.log(`  Email: ${rem.email}`);
    console.log(`  Stripe Connected Account: ${rem.stripe_connected_account_id || 'Not connected'}`);
    console.log(`  Status: ${rem.status}`);
    console.log('');
  });

  // Step 3: Set up test scenario
  console.log('Step 3: Setting up test scenario...');

  const testUser = subscribers[0];

  // Calculate date 25 days from now
  const testExpiryDate = new Date();
  testExpiryDate.setDate(testExpiryDate.getDate() + 25);
  const testExpiryString = testExpiryDate.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`Setting ${testUser.email}'s city sticker expiry to: ${testExpiryString} (25 days from now)`);

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      city_sticker_expiry: testExpiryString,
      vehicle_type: testUser.vehicle_type || 'P', // Default to Passenger
      license_plate: testUser.license_plate || 'TEST123',
    })
    .eq('user_id', testUser.user_id);

  if (updateError) {
    console.error('Error updating test user:', updateError);
    return;
  }

  console.log('✅ Test user updated!\n');

  // Step 4: Show what will happen
  console.log('📋 Expected Behavior:');
  console.log('  1. Cron job finds this user (25 days until expiry)');
  console.log('  2. Charges customer via saved payment method');
  console.log('  3. Transfers $100 sticker fee directly to remitter');
  console.log('  4. Transfers $12 service fee to remitter from platform');
  console.log('  5. Creates order in renewal_orders table');
  console.log('  6. Logs charge in renewal_charges table\n');

  console.log('🚀 Ready to trigger cron job!');
  console.log('\nTo manually trigger, run:');
  console.log(`curl -X POST http://localhost:3001/api/cron/process-all-renewals \\`);
  console.log(`  -H "Authorization: Bearer ${process.env.CRON_SECRET}"`);
  console.log('\nOr for production:');
  console.log(`curl -X POST https://ticketless-chicago-656c7lysw-randyvollraths-projects.vercel.app/api/cron/process-all-renewals \\`);
  console.log(`  -H "Authorization: Bearer ${process.env.CRON_SECRET}"`);
}

testRenewalCron().catch(console.error);
