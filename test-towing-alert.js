// Test towing alert system
// Usage: node test-towing-alert.js YOUR_LICENSE_PLATE
// Example: node test-towing-alert.js ABC1234

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testTowingAlert() {
  const testPlate = process.argv[2]?.toUpperCase();

  if (!testPlate) {
    console.log('Usage: node test-towing-alert.js YOUR_LICENSE_PLATE');
    console.log('Example: node test-towing-alert.js ABC1234');
    process.exit(1);
  }

  console.log(`\n🔍 Testing towing alert system for plate: ${testPlate}\n`);

  // 1. Check if plate exists in user_profiles
  console.log('Step 1: Checking user_profiles table...');
  const { data: users, error: userError } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone_number, license_plate, license_state, city, notify_sms, notify_email')
    .eq('license_plate', testPlate);

  if (userError) {
    console.error('Error checking users:', userError);
    return;
  }

  if (!users || users.length === 0) {
    console.log('❌ No user found with plate:', testPlate);
    console.log('\n💡 To test:');
    console.log('   1. Add this plate to your user profile in settings');
    console.log('   2. Or run: node test-towing-alert.js YOUR_ACTUAL_PLATE');
    return;
  }

  console.log(`✅ Found ${users.length} user(s) with this plate:`);
  users.forEach(u => {
    console.log(`   - Email: ${u.email}`);
    console.log(`     Phone: ${u.phone_number}`);
    console.log(`     City: ${u.city}`);
    console.log(`     State: ${u.license_state || 'IL'}`);
    console.log(`     SMS alerts: ${u.notify_sms ? '✓' : '✗'}`);
    console.log(`     Email alerts: ${u.notify_email ? '✓' : '✗'}`);
  });

  // 2. Check if this plate was towed
  console.log('\nStep 2: Checking towed_vehicles table...');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const { data: tows, error: towError } = await supabase
    .from('towed_vehicles')
    .select('*')
    .eq('plate', testPlate)
    .gte('tow_date', yesterday.toISOString())
    .order('tow_date', { ascending: false });

  if (towError) {
    console.error('Error checking tows:', towError);
    return;
  }

  if (!tows || tows.length === 0) {
    console.log('✅ Good news! This car has NOT been towed in the last 24 hours.');

    // Show most recent tows for context
    const { data: recentTows } = await supabase
      .from('towed_vehicles')
      .select('plate, tow_date, towed_to_address')
      .order('tow_date', { ascending: false })
      .limit(3);

    console.log('\n📊 Most recent tows in database:');
    recentTows?.forEach(t => {
      console.log(`   - ${t.plate} towed on ${new Date(t.tow_date).toLocaleDateString()}`);
    });

    return;
  }

  // Found tow!
  console.log(`🚨 ALERT! This car WAS towed:`);
  tows.forEach(tow => {
    console.log(`\n   Towed: ${new Date(tow.tow_date).toLocaleString()}`);
    console.log(`   Vehicle: ${tow.color} ${tow.make}`);
    console.log(`   Location: ${tow.towed_to_address}`);
    console.log(`   Phone: ${tow.tow_facility_phone}`);
    console.log(`   Inventory: ${tow.inventory_number}`);
    console.log(`   Notified users: ${tow.notified_users?.length || 0}`);
  });

  // 3. Test notification logic
  console.log('\nStep 3: Testing notification logic...');
  const user = users[0];
  const tow = tows[0];

  const alreadyNotified = tow.notified_users?.includes(user.user_id);

  if (alreadyNotified) {
    console.log('ℹ️  User has already been notified about this tow');
  } else {
    console.log('📧 User would receive notification now!');

    if (user.notify_sms && user.phone_number) {
      console.log(`   ✓ SMS would be sent to ${user.phone_number}`);
    }
    if (user.notify_email && user.email) {
      console.log(`   ✓ Email would be sent to ${user.email}`);
    }
  }

  console.log('\n✅ Test complete!\n');
}

testTowingAlert().catch(console.error);
