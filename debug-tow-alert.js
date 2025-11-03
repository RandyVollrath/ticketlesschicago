// Debug script to check why you didn't get a tow alert
// Usage: node debug-tow-alert.js XXKXKWS

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugTowAlert() {
  const plate = process.argv[2]?.toUpperCase() || 'XXKXKWS';

  console.log(`\n🔍 Debugging tow alert for plate: ${plate}\n`);

  // 1. Check if user has this plate
  console.log('STEP 1: Checking user_profiles...');
  const { data: users, error: userError } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone_number, license_plate, notify_sms, created_at, updated_at')
    .eq('license_plate', plate);

  if (userError) {
    console.error('❌ Error querying users:', userError);
    return;
  }

  if (!users || users.length === 0) {
    console.log('❌ NO USER found with this plate!');
    console.log('   → You need to add this plate to your profile in Settings');
    return;
  }

  console.log(`✅ Found user with plate:`);
  console.log(`   Email: ${users[0].email}`);
  console.log(`   Phone: ${users[0].phone_number}`);
  console.log(`   SMS Alerts: ${users[0].notify_sms ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   Plate added: ${new Date(users[0].created_at).toLocaleString()}`);
  console.log(`   Last updated: ${new Date(users[0].updated_at).toLocaleString()}`);

  if (!users[0].notify_sms) {
    console.log('\n⚠️  SMS alerts are DISABLED for this user!');
  }

  // 2. Check if vehicle is in towed database
  console.log('\nSTEP 2: Checking towed_vehicles database...');
  const { data: tows, error: towError } = await supabase
    .from('towed_vehicles')
    .select('*')
    .ilike('plate', plate)
    .order('tow_date', { ascending: false })
    .limit(1);

  if (towError) {
    console.error('❌ Error querying towed vehicles:', towError);
    return;
  }

  if (!tows || tows.length === 0) {
    console.log('❌ This vehicle is NOT in the towed database');
    console.log('   → Either it wasn\'t towed, or city data hasn\'t updated yet');
    return;
  }

  const tow = tows[0];
  console.log(`✅ Found in towed database:`);
  console.log(`   Towed on: ${new Date(tow.tow_date).toLocaleString()}`);
  console.log(`   Vehicle: ${tow.color} ${tow.make}`);
  console.log(`   Impound: ${tow.towed_to_address}`);
  console.log(`   Inventory #: ${tow.inventory_number}`);
  console.log(`   DB record created: ${new Date(tow.created_at).toLocaleString()}`);

  // 3. Check notified_users array
  console.log('\nSTEP 3: Checking notification status...');
  const notifiedUsers = tow.notified_users || [];
  console.log(`   Notified users array: ${JSON.stringify(notifiedUsers)}`);

  if (notifiedUsers.includes(users[0].user_id)) {
    console.log(`\n❌ REASON: You were already notified!`);
    console.log(`   Your user_id (${users[0].user_id}) is in the notified_users array`);
    console.log(`   This prevents duplicate notifications`);
  } else {
    console.log(`\n✅ You are NOT in the notified_users array`);
  }

  // 4. Check timing
  console.log('\nSTEP 4: Timing analysis...');
  const towDate = new Date(tow.tow_date);
  const plateAdded = new Date(users[0].updated_at);
  const now = new Date();
  const hoursSinceTow = (now - towDate) / (1000 * 60 * 60);
  const hoursSincePlateAdded = (now - plateAdded) / (1000 * 60 * 60);

  console.log(`   Tow happened: ${hoursSinceTow.toFixed(1)} hours ago`);
  console.log(`   Plate added: ${hoursSincePlateAdded.toFixed(1)} hours ago`);
  console.log(`   Tow in last 24hrs? ${hoursSinceTow < 24 ? 'YES ✅' : 'NO ❌'}`);

  if (hoursSinceTow > 24) {
    console.log(`\n❌ REASON: Tow is too old!`);
    console.log(`   Cron only checks vehicles towed in last 24 hours`);
    console.log(`   This tow is ${hoursSinceTow.toFixed(1)} hours old`);
  }

  // 5. Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!users[0].notify_sms) {
    console.log('⚠️  Problem: SMS alerts are disabled in your settings');
  } else if (notifiedUsers.includes(users[0].user_id)) {
    console.log('⚠️  Problem: You were already notified (duplicate prevention)');
    console.log('   → Likely the cron ran BEFORE you added your plate');
    console.log('   → When you added the plate, it was too late - you were already marked as notified');
  } else if (hoursSinceTow > 24) {
    console.log('⚠️  Problem: Tow is older than 24 hours');
  } else {
    console.log('⚠️  Problem: Unknown - cron may not have run yet');
    console.log('   → Cron runs hourly at :15 (10:15, 11:15, etc.)');
    console.log('   → Check logs or wait for next run');
  }

  console.log('\n💡 RECOMMENDATION:');
  if (notifiedUsers.length === 0 && hoursSinceTow < 24) {
    console.log('   The cron hasn\'t run yet since this tow was added to DB');
    console.log('   Wait for the next hourly run at the :15 mark');
  } else if (notifiedUsers.includes(users[0].user_id)) {
    console.log('   This is a known edge case:');
    console.log('   1. Your car was towed earlier today');
    console.log('   2. City updated their database');
    console.log('   3. Our cron ran and found NO users with that plate');
    console.log('   4. Cron marked it as "processed" (empty notified_users array is ignored)');
    console.log('   5. You added your plate 1.5 hours ago');
    console.log('   6. Next cron run saw you but you were already in notified_users');
    console.log('');
    console.log('   FIX: We should NOT add users to notified_users if they weren\'t actually notified!');
  }

  console.log('\n');
}

debugTowAlert().catch(console.error);
