#!/usr/bin/env node

// Check Randy's notification data in both tables
// Run: node scripts/check-randy-notifications.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

// Try with anon key first (for reading)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkRandyNotifications() {
  console.log('🔍 CHECKING RANDY\'S NOTIFICATION DATA\n');
  console.log('=' .repeat(60));
  
  // Check in users table
  console.log('\n📊 CHECKING USERS TABLE:');
  console.log('-----------------------');
  
  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .maybeSingle();
    
  if (usersError) {
    console.log('❌ Error querying users table:', usersError.message);
  } else if (!usersData) {
    console.log('❌ Randy not found in users table');
  } else {
    console.log('✅ Found Randy in users table!');
    console.log('  ID:', usersData.id);
    console.log('  Phone:', usersData.phone || '❌ NOT SET');
    console.log('  City Sticker Expiry:', usersData.city_sticker_expiry || '❌ NOT SET');
    console.log('  License Plate Expiry:', usersData.license_plate_expiry || '❌ NOT SET');
    console.log('  Emissions Date:', usersData.emissions_date || '❌ NOT SET');
    console.log('  Notification Preferences:', JSON.stringify(usersData.notification_preferences || {}));
    
    // Calculate days until renewals
    const today = new Date();
    console.log('\n  📅 Days until renewals:');
    
    const renewals = [
      { date: usersData.city_sticker_expiry, type: 'City Sticker' },
      { date: usersData.license_plate_expiry, type: 'License Plate' },
      { date: usersData.emissions_date, type: 'Emissions Test' }
    ];
    
    for (const renewal of renewals) {
      if (renewal.date) {
        const dueDate = new Date(renewal.date);
        const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`    ${renewal.type}: ${daysUntil} days (${renewal.date})`);
      }
    }
  }
  
  // Check in user_profiles table  
  console.log('\n📊 CHECKING USER_PROFILES TABLE:');
  console.log('--------------------------------');
  
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .maybeSingle();
    
  if (profileError) {
    console.log('❌ Error querying user_profiles table:', profileError.message);
  } else if (!profileData) {
    console.log('❌ Randy not found in user_profiles table');
  } else {
    console.log('✅ Found Randy in user_profiles table!');
    console.log('  User ID:', profileData.user_id);
    console.log('  Phone:', profileData.phone_number || '❌ NOT SET');
    console.log('  City Sticker Expiry:', profileData.city_sticker_expiry || '❌ NOT SET');
    console.log('  License Plate Expiry:', profileData.license_plate_expiry || '❌ NOT SET');
    console.log('  Emissions Date:', profileData.emissions_date || '❌ NOT SET');
    console.log('  Notification Preferences:', JSON.stringify(profileData.notification_preferences || {}));
    console.log('  Street Cleaning Ward:', profileData.home_address_ward || '❌ NOT SET');
    console.log('  Street Cleaning Section:', profileData.home_address_section || '❌ NOT SET');
    
    // Calculate days until renewals
    const today = new Date();
    console.log('\n  📅 Days until renewals:');
    
    const renewals = [
      { date: profileData.city_sticker_expiry, type: 'City Sticker' },
      { date: profileData.license_plate_expiry, type: 'License Plate' },
      { date: profileData.emissions_date, type: 'Emissions Date' }
    ];
    
    for (const renewal of renewals) {
      if (renewal.date) {
        const dueDate = new Date(renewal.date);
        const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`    ${renewal.type}: ${daysUntil} days (${renewal.date})`);
      }
    }
  }
  
  // Now let's check what the notification system actually queries
  console.log('\n🔄 NOTIFICATION SYSTEM STATUS:');
  console.log('------------------------------');
  
  // The notifications-fixed.ts queries user_profiles table
  console.log('Vehicle renewals: Queries user_profiles table');
  console.log('Street cleaning: Queries user_profiles table');
  
  if (profileData) {
    console.log('\n✅ Randy IS in user_profiles - notifications should work!');
  } else if (usersData) {
    console.log('\n⚠️  Randy is in users table but NOT in user_profiles');
    console.log('   This means notifications will NOT be sent!');
    console.log('   Need to migrate data from users to user_profiles table');
  } else {
    console.log('\n❌ Randy not found in either table!');
  }
  
  console.log('\n🚀 TO TEST NOTIFICATIONS:');
  console.log('-------------------------');
  console.log('1. First ensure Randy is in user_profiles table with renewal dates');
  console.log('2. Then run: curl -X POST http://localhost:3000/api/notifications/process');
  console.log('3. For street cleaning: curl -X POST http://localhost:3000/api/street-cleaning/process');
}

checkRandyNotifications().catch(console.error);