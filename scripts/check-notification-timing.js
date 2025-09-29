#!/usr/bin/env node

// Check when Randy's notifications would trigger
// Run: node scripts/check-notification-timing.js

require('dotenv').config({ path: '.env.local' });

async function checkNotificationTiming() {
  console.log('📅 NOTIFICATION TIMING CHECKER\n');
  console.log('=' .repeat(60));
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log(`Today's date: ${today.toISOString().split('T')[0]}`);
  console.log('\nChecking when notifications would trigger for randyvollrath@gmail.com\n');
  
  // Test with different renewal dates
  const testScenarios = [
    { 
      name: 'City Sticker',
      testDates: [
        new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000),  // 7 days from now
        new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000),  // 1 day from now
        new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
        new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      ]
    }
  ];
  
  const defaultReminderDays = [30, 7, 1];
  
  console.log(`Default reminder days: [${defaultReminderDays.join(', ')}]`);
  console.log('\n📊 NOTIFICATION TRIGGER DATES:\n');
  
  for (const scenario of testScenarios) {
    console.log(`${scenario.name}:`);
    console.log('-'.repeat(40));
    
    for (const testDate of scenario.testDates) {
      const dateStr = testDate.toISOString().split('T')[0];
      const daysUntil = Math.floor((testDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const wouldTrigger = defaultReminderDays.includes(daysUntil);
      
      console.log(`  Renewal date: ${dateStr} (${daysUntil} days away)`);
      console.log(`  Would trigger today: ${wouldTrigger ? '✅ YES' : '❌ NO'}`);
      
      if (wouldTrigger) {
        console.log(`  Notification type: ${daysUntil}-day reminder`);
      }
      console.log('');
    }
  }
  
  console.log('\n💡 KEY INSIGHT:');
  console.log('----------------');
  console.log('Notifications ONLY send when the number of days until renewal');
  console.log('EXACTLY matches one of the reminder days [30, 7, 1].');
  console.log('');
  console.log('For example:');
  console.log('- If renewal is 30 days away → Sends 30-day reminder');
  console.log('- If renewal is 29 days away → NO notification');
  console.log('- If renewal is 7 days away → Sends 7-day reminder');
  console.log('- If renewal is 6 days away → NO notification');
  console.log('');
  console.log('🔍 TO CHECK RANDY\'S ACTUAL DATES:');
  console.log('-----------------------------------');
  console.log('1. Go to Supabase dashboard');
  console.log('2. Check user_profiles table');
  console.log('3. Look for randyvollrath@gmail.com');
  console.log('4. Check these columns:');
  console.log('   - city_sticker_expiry');
  console.log('   - license_plate_expiry');
  console.log('   - emissions_date');
  console.log('');
  console.log('Then calculate how many days away each date is.');
  console.log('If none are exactly 30, 7, or 1 days away, no notifications will send.');
  
  // Show when next notifications would trigger for common dates
  console.log('\n📅 WHEN NOTIFICATIONS WOULD TRIGGER:');
  console.log('------------------------------------');
  
  for (let days = 0; days <= 35; days++) {
    const futureDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    const dateStr = futureDate.toISOString().split('T')[0];
    
    if (defaultReminderDays.includes(days)) {
      console.log(`✅ ${dateStr}: Would send ${days}-day reminder`);
    }
  }
}

checkNotificationTiming().catch(console.error);