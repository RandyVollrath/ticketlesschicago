// Quick script to manually insert a test tow record for testing the alert system
// Usage: node test-tow-alert-manual.js YOUR_LICENSE_PLATE

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function insertTestTow() {
  const testPlate = process.argv[2]?.toUpperCase();

  if (!testPlate) {
    console.log('Usage: node test-tow-alert-manual.js YOUR_LICENSE_PLATE');
    console.log('Example: node test-tow-alert-manual.js ABC1234');
    process.exit(1);
  }

  console.log(`\n🔧 Creating test tow record for plate: ${testPlate}\n`);

  // Check if user has this plate registered
  const { data: users, error: userError } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone_number, license_plate')
    .eq('license_plate', testPlate);

  if (userError || !users || users.length === 0) {
    console.log('❌ No user found with this plate!');
    console.log('\n💡 Steps to test:');
    console.log('   1. Go to Settings page in your app');
    console.log('   2. Add this license plate to your profile');
    console.log('   3. Run this script again');
    return;
  }

  console.log(`✅ Found user with plate: ${users[0].email}`);

  // Insert a test tow record (towed within last hour)
  const towDate = new Date();
  towDate.setMinutes(towDate.getMinutes() - 30); // 30 minutes ago

  const { data: tow, error: towError } = await supabase
    .from('towed_vehicles')
    .insert({
      tow_date: towDate.toISOString(),
      make: 'TEST',
      color: 'RED',
      plate: testPlate,
      state: 'IL',
      towed_to_address: '701 N Sacramento Blvd, Chicago, IL (TEST)',
      tow_facility_phone: '312-746-4444',
      inventory_number: `TEST-${Date.now()}`,
      notified_users: [] // Empty array means no one has been notified yet
    })
    .select()
    .single();

  if (towError) {
    console.error('❌ Error inserting test tow:', towError);
    return;
  }

  console.log(`\n✅ Test tow record created!`);
  console.log(`   Inventory #: ${tow.inventory_number}`);
  console.log(`   Towed at: ${new Date(tow.tow_date).toLocaleString()}`);
  console.log(`   Location: ${tow.towed_to_address}`);

  console.log(`\n📋 Next steps:`);
  console.log(`   1. Trigger the cron manually:`);
  console.log(`      curl -X POST https://autopilotamerica.com/api/cron/check-towed-vehicles \\`);
  console.log(`        -H "Authorization: Bearer $CRON_SECRET"`);
  console.log(`\n   2. Or wait for the hourly cron to run automatically`);
  console.log(`\n   3. Check if you receive SMS/email notification`);
  console.log(`\n   4. Clean up test data:`);
  console.log(`      DELETE FROM towed_vehicles WHERE inventory_number = '${tow.inventory_number}';`);

  console.log(`\n✅ Test setup complete!\n`);
}

insertTestTow().catch(console.error);
