#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPhoneNumber() {
  const phone = '13125354254';
  const phoneVariants = [
    phone,
    '+' + phone,
    '+1' + phone.substring(1)
  ];

  console.log('Searching for phone number:', phone);
  console.log('Checking variants:', phoneVariants);
  console.log('\n=== USER PROFILES ===\n');

  // Check user_profiles
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone, phone_number, home_address_full, home_address_ward, home_address_section, notify_sms, phone_call_enabled, created_at')
    .or(phoneVariants.map(p => `phone.eq.${p},phone_number.eq.${p}`).join(','));

  if (profileError) {
    console.error('Error querying user_profiles:', profileError);
  } else if (profiles && profiles.length > 0) {
    console.log(`Found ${profiles.length} user_profile(s):\n`);
    profiles.forEach((profile, idx) => {
      console.log(`Profile ${idx + 1}:`);
      console.log('  User ID:', profile.user_id);
      console.log('  Email:', profile.email);
      console.log('  Phone:', profile.phone);
      console.log('  Phone Number:', profile.phone_number);
      console.log('  Address:', profile.home_address_full);
      console.log('  Ward:', profile.home_address_ward);
      console.log('  Section:', profile.home_address_section);
      console.log('  SMS Enabled:', profile.notify_sms);
      console.log('  Voice Enabled:', profile.phone_call_enabled);
      console.log('  Created:', profile.created_at);
      console.log('');
    });
  } else {
    console.log('No profiles found with this phone number');
  }

  console.log('\n=== VEHICLE REMINDERS ===\n');

  // Check vehicle_reminders (legacy table)
  const { data: reminders, error: reminderError } = await supabase
    .from('vehicle_reminders')
    .select('id, user_id, email, phone, notification_preferences, created_at')
    .or(phoneVariants.map(p => `phone.eq.${p}`).join(','));

  if (reminderError) {
    console.error('Error querying vehicle_reminders:', reminderError);
  } else if (reminders && reminders.length > 0) {
    console.log(`Found ${reminders.length} vehicle_reminder(s):\n`);
    reminders.forEach((reminder, idx) => {
      console.log(`Reminder ${idx + 1}:`);
      console.log('  ID:', reminder.id);
      console.log('  User ID:', reminder.user_id);
      console.log('  Email:', reminder.email);
      console.log('  Phone:', reminder.phone);
      console.log('  Address:', reminder.street_cleaning_address);
      console.log('  Notification Prefs:', JSON.stringify(reminder.notification_preferences));
      console.log('  Created:', reminder.created_at);
      console.log('');
    });
  } else {
    console.log('No vehicle reminders found with this phone number');
  }

  console.log('\n=== USERS TABLE ===\n');

  // Check users table
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, email, phone, created_at')
    .or(phoneVariants.map(p => `phone.eq.${p}`).join(','));

  if (userError) {
    console.error('Error querying users:', userError);
  } else if (users && users.length > 0) {
    console.log(`Found ${users.length} user(s):\n`);
    users.forEach((user, idx) => {
      console.log(`User ${idx + 1}:`);
      console.log('  ID:', user.id);
      console.log('  Email:', user.email);
      console.log('  Phone:', user.phone);
      console.log('  Created:', user.created_at);
      console.log('');
    });
  } else {
    console.log('No users found with this phone number');
  }
}

checkPhoneNumber().catch(console.error);
