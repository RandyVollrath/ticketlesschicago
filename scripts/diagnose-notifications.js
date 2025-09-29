#!/usr/bin/env node

// Diagnose why notifications aren't sending
// Run: node scripts/diagnose-notifications.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnoseNotifications() {
  console.log('🔍 NOTIFICATION DIAGNOSTICS\n');
  console.log('=' .repeat(60));
  
  // Check environment variables
  console.log('\n📋 ENVIRONMENT CHECK:');
  console.log('---------------------');
  const envVars = {
    'CLICKSEND_USERNAME': process.env.CLICKSEND_USERNAME,
    'CLICKSEND_API_KEY': process.env.CLICKSEND_API_KEY,
    'RESEND_API_KEY': process.env.RESEND_API_KEY,
    'RESEND_FROM': process.env.RESEND_FROM,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  
  for (const [key, value] of Object.entries(envVars)) {
    const status = value ? '✅' : '❌';
    const displayValue = value ? 
      (key.includes('KEY') ? '***' + value.slice(-4) : value) : 
      'NOT SET';
    console.log(`${status} ${key}: ${displayValue}`);
  }
  
  // Check Randy's user data
  console.log('\n👤 USER DATA CHECK (randyvollrath@gmail.com):');
  console.log('----------------------------------------------');
  
  const { data: userData, error: userError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  if (userError || !userData) {
    console.log('❌ User not found in user_profiles table');
    console.log('Error:', userError?.message);
  } else {
    console.log('✅ User found in user_profiles');
    console.log('  User ID:', userData.user_id);
    console.log('  Phone:', userData.phone_number || '❌ NOT SET');
    console.log('  City Sticker Expiry:', userData.city_sticker_expiry || '❌ NOT SET');
    console.log('  License Plate Expiry:', userData.license_plate_expiry || '❌ NOT SET');
    console.log('  Emissions Date:', userData.emissions_date || '❌ NOT SET');
    console.log('  Notification Preferences:', JSON.stringify(userData.notification_preferences || {}));
    
    // Calculate days until renewals
    if (userData.city_sticker_expiry || userData.license_plate_expiry || userData.emissions_date) {
      console.log('\n📅 RENEWAL TIMING:');
      const today = new Date();
      
      const renewals = [
        { date: userData.city_sticker_expiry, type: 'City Sticker' },
        { date: userData.license_plate_expiry, type: 'License Plate' },
        { date: userData.emissions_date, type: 'Emissions Test' }
      ];
      
      for (const renewal of renewals) {
        if (renewal.date) {
          const dueDate = new Date(renewal.date);
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          console.log(`  ${renewal.type}: ${daysUntil} days (${renewal.date})`);
          
          const reminderDays = userData.notification_preferences?.reminder_days || [30, 7, 1];
          if (reminderDays.includes(daysUntil)) {
            console.log(`    ✅ Should trigger ${daysUntil}-day reminder TODAY!`);
          }
        }
      }
    }
    
    // Check street cleaning settings
    console.log('\n🧹 STREET CLEANING SETTINGS:');
    console.log('  Ward:', userData.home_address_ward || '❌ NOT SET');
    console.log('  Section:', userData.home_address_section || '❌ NOT SET');
    console.log('  Full Address:', userData.home_address_full || '❌ NOT SET');
    console.log('  Is Canary:', userData.is_canary ? '✅ YES' : 'NO');
  }
  
  // Test actual notification sending
  console.log('\n📨 NOTIFICATION SERVICE TEST:');
  console.log('------------------------------');
  
  if (process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY) {
    console.log('✅ ClickSend credentials found - SMS/Voice should work');
  } else {
    console.log('❌ ClickSend credentials missing - SMS/Voice will NOT send');
    console.log('   Add CLICKSEND_USERNAME and CLICKSEND_API_KEY to .env.local');
  }
  
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    console.log('✅ Resend credentials found - Email should work');
  } else {
    console.log('❌ Resend credentials missing - Emails will NOT send');
    console.log('   Add RESEND_API_KEY and RESEND_FROM to .env.local');
  }
  
  // Check cron configuration
  console.log('\n⏰ CRON SCHEDULE:');
  console.log('-----------------');
  console.log('Vehicle renewals: Daily at 14:00 UTC (9 AM Chicago)');
  console.log('Street cleaning: NOT SCHEDULED (needs manual setup)');
  
  console.log('\n💡 RECOMMENDATIONS:');
  console.log('-------------------');
  
  const issues = [];
  
  if (!process.env.CLICKSEND_USERNAME || !process.env.CLICKSEND_API_KEY) {
    issues.push('1. Add ClickSend credentials to .env.local for SMS/Voice');
  }
  
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    issues.push('2. Add Resend credentials to .env.local for Email');
  }
  
  if (userData) {
    if (!userData.phone_number) {
      issues.push('3. Add phone number to user profile for SMS/Voice notifications');
    }
    
    if (!userData.city_sticker_expiry && !userData.license_plate_expiry && !userData.emissions_date) {
      issues.push('4. Add renewal dates to user profile to trigger notifications');
    }
    
    if (!userData.home_address_ward || !userData.home_address_section) {
      issues.push('5. Add street cleaning address (ward/section) for street cleaning notifications');
    }
  }
  
  if (issues.length === 0) {
    console.log('✅ All configurations look good!');
    console.log('\n🚀 TEST NOTIFICATIONS NOW:');
    console.log('curl -X POST http://localhost:3000/api/notifications/process');
    console.log('curl -X POST http://localhost:3000/api/street-cleaning/process');
  } else {
    issues.forEach(issue => console.log(issue));
    
    console.log('\n📝 EXAMPLE .env.local ADDITIONS:');
    console.log('--------------------------------');
    console.log('# ClickSend API (for SMS/Voice)');
    console.log('CLICKSEND_USERNAME=your_clicksend_username');
    console.log('CLICKSEND_API_KEY=your_clicksend_api_key');
    console.log('');
    console.log('# Resend API (for Email)');
    console.log('RESEND_API_KEY=re_xxxxxxxxxxxxx');
    console.log('RESEND_FROM=notifications@yourdomain.com');
  }
}

diagnoseNotifications().catch(console.error);