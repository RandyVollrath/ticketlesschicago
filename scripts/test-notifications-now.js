#!/usr/bin/env node

// Test notification system RIGHT NOW without waiting for cron
// Run: node scripts/test-notifications-now.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testNotifications() {
  console.log('🔔 MANUAL NOTIFICATION TEST\n');
  
  // Get the test user
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', '+12243217290')
    .single();
    
  if (error || !users) {
    console.error('❌ Could not find test user with phone +12243217290');
    return;
  }
  
  console.log('✅ Found test user:', users.email);
  console.log('📱 Phone:', users.phone);
  console.log('📅 City Sticker Expiry:', users.city_sticker_expiry);
  console.log('📅 License Plate Expiry:', users.license_plate_expiry);
  console.log('📅 Emissions Date:', users.emissions_date);
  console.log('🔔 Notification Preferences:', users.notification_preferences);
  
  // Calculate days until each renewal
  const today = new Date();
  const renewals = [
    { date: users.city_sticker_expiry, type: 'City Sticker' },
    { date: users.license_plate_expiry, type: 'License Plate' },
    { date: users.emissions_date, type: 'Emissions Test' }
  ];
  
  console.log('\n📊 Days until renewals:');
  for (const renewal of renewals) {
    if (renewal.date) {
      const dueDate = new Date(renewal.date);
      const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`- ${renewal.type}: ${daysUntil} days (${renewal.date})`);
      
      const reminderDays = users.notification_preferences?.reminder_days || [30, 7, 1];
      if (reminderDays.includes(daysUntil)) {
        console.log(`  ✅ Should send ${daysUntil}-day reminder TODAY!`);
      }
    }
  }
  
  console.log('\n🚀 To trigger notifications manually, run:');
  console.log('curl -X POST https://www.ticketlessamerica.com/api/notifications/process');
  console.log('\nOR locally:');
  console.log('curl -X POST http://localhost:3000/api/notifications/process');
}

testNotifications().catch(console.error);