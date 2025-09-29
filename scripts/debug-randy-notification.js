#!/usr/bin/env node

// Debug why Randy didn't get notification for tomorrow's city sticker
// Run: node scripts/debug-randy-notification.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugNotification() {
  console.log('🔍 DEBUGGING MISSING NOTIFICATION\n');
  console.log('=' .repeat(60));
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  
  console.log(`Today: ${today.toISOString().split('T')[0]}`);
  console.log(`Tomorrow: ${tomorrow.toISOString().split('T')[0]}`);
  console.log(`\nYou said city sticker is due TOMORROW, so you should get a 1-day reminder TODAY!\n`);
  
  // Get Randy's data
  console.log('📊 Fetching Randy\'s data from user_profiles...\n');
  
  const { data: userData, error: userError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  if (userError) {
    console.log('❌ Error fetching from user_profiles:', userError.message);
    console.log('\n🔄 Trying users table instead...\n');
    
    // Try the old users table
    const { data: oldUserData, error: oldError } = await supabase
      .from('users')
      .select('*')
      .eq('email', 'randyvollrath@gmail.com')
      .single();
      
    if (!oldError && oldUserData) {
      console.log('✅ Found in users table!');
      console.log('  City Sticker Expiry:', oldUserData.city_sticker_expiry);
      console.log('  Phone:', oldUserData.phone);
      console.log('  Notification Preferences:', JSON.stringify(oldUserData.notification_preferences));
      
      console.log('\n⚠️  PROBLEM FOUND!');
      console.log('Your data is in the OLD "users" table, but the notification system');
      console.log('is looking in the NEW "user_profiles" table!');
      console.log('\n✅ SOLUTION: Need to migrate your data from users → user_profiles');
      return;
    }
  }
  
  if (!userData) {
    console.log('❌ User not found in either table!');
    return;
  }
  
  console.log('✅ Found in user_profiles table');
  console.log('  User ID:', userData.user_id);
  console.log('  Email:', userData.email);
  console.log('  Phone:', userData.phone_number || '❌ MISSING');
  console.log('  City Sticker Expiry:', userData.city_sticker_expiry || '❌ MISSING');
  console.log('  License Plate Expiry:', userData.license_plate_expiry || 'Not set');
  console.log('  Emissions Date:', userData.emissions_date || 'Not set');
  
  // Check the city sticker date
  if (userData.city_sticker_expiry) {
    const stickerDate = new Date(userData.city_sticker_expiry);
    const daysUntil = Math.floor((stickerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    console.log(`\n📅 City Sticker Analysis:`);
    console.log(`  Expiry date in DB: ${userData.city_sticker_expiry}`);
    console.log(`  Days until expiry: ${daysUntil}`);
    
    if (daysUntil === 1) {
      console.log('  ✅ Should trigger 1-day reminder TODAY!');
    } else if (daysUntil === 0) {
      console.log('  ⚠️  Expires TODAY - too late for 1-day reminder');
    } else if (daysUntil < 0) {
      console.log('  ❌ Already expired!');
    } else {
      console.log(`  ❌ ${daysUntil} days away - won't trigger today`);
    }
  }
  
  // Check notification preferences
  console.log('\n🔔 Notification Preferences:');
  const prefs = userData.notification_preferences || {};
  console.log('  Raw preferences:', JSON.stringify(prefs));
  console.log('  SMS enabled:', prefs.sms !== false ? '✅' : '❌');
  console.log('  Email enabled:', prefs.email !== false ? '✅' : '❌');
  console.log('  Voice enabled:', prefs.voice === true ? '✅' : '❌');
  console.log('  Reminder days:', prefs.reminder_days || [30, 7, 1]);
  
  // Check what would be needed for notification
  console.log('\n📋 Requirements for notification to send:');
  const checks = {
    'User in user_profiles table': !!userData,
    'Has city_sticker_expiry date': !!userData?.city_sticker_expiry,
    'Date is 1 day away (for tomorrow)': userData?.city_sticker_expiry ? 
      Math.floor((new Date(userData.city_sticker_expiry).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) === 1 : false,
    'Has phone number (for SMS)': !!userData?.phone_number,
    'SMS notifications enabled': prefs.sms !== false,
    'Email notifications enabled': prefs.email !== false
  };
  
  for (const [requirement, met] of Object.entries(checks)) {
    console.log(`  ${met ? '✅' : '❌'} ${requirement}`);
  }
  
  // Final diagnosis
  console.log('\n🎯 DIAGNOSIS:');
  console.log('-------------');
  
  const problems = [];
  if (!userData) {
    problems.push('User not in user_profiles table (might be in old users table)');
  }
  if (userData && !userData.city_sticker_expiry) {
    problems.push('City sticker expiry date not set in user_profiles');
  }
  if (userData && !userData.phone_number && prefs.sms !== false) {
    problems.push('No phone number for SMS notifications');
  }
  if (userData?.city_sticker_expiry) {
    const daysUntil = Math.floor((new Date(userData.city_sticker_expiry).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil !== 1 && daysUntil !== 7 && daysUntil !== 30) {
      problems.push(`City sticker is ${daysUntil} days away, not matching reminder days [30, 7, 1]`);
    }
  }
  
  if (problems.length === 0) {
    console.log('✅ Everything looks correct! Notification should have been sent.');
    console.log('   Check Vercel function logs for any errors during execution.');
  } else {
    console.log('Problems found:');
    problems.forEach(p => console.log(`  - ${p}`));
  }
  
  // Show SQL to check/fix
  console.log('\n💻 SQL TO CHECK IN SUPABASE:');
  console.log('-----------------------------');
  console.log(`
-- Check user_profiles table:
SELECT email, phone_number, city_sticker_expiry, 
       license_plate_expiry, emissions_date, 
       notification_preferences
FROM user_profiles 
WHERE email = 'randyvollrath@gmail.com';

-- Check old users table:
SELECT email, phone, city_sticker_expiry, 
       license_plate_expiry, emissions_date,
       notification_preferences
FROM users 
WHERE email = 'randyvollrath@gmail.com';

-- If data is in users table but not user_profiles, migrate it:
-- UPDATE user_profiles 
-- SET city_sticker_expiry = '2025-09-30',
--     phone_number = 'your-phone-number'
-- WHERE email = 'randyvollrath@gmail.com';
  `);
}

debugNotification().catch(console.error);