#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRandyAccount() {
  const email = 'randyvollrath@gmail.com';

  console.log('Checking for duplicate entries for:', email);
  console.log('\n=== USER PROFILES ===\n');

  // Check user_profiles
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email);

  if (profileError) {
    console.error('Error querying user_profiles:', profileError);
  } else if (profiles) {
    console.log(`Found ${profiles.length} user_profile(s):\n`);
    profiles.forEach((profile, idx) => {
      console.log(`Profile ${idx + 1}:`);
      console.log('  User ID:', profile.user_id);
      console.log('  Email:', profile.email);
      console.log('  Phone:', profile.phone_number || profile.phone);
      console.log('  Ward:', profile.home_address_ward);
      console.log('  Section:', profile.home_address_section);
      console.log('  Address:', profile.home_address_full);
      console.log('  notify_sms:', profile.notify_sms);
      console.log('  notify_email:', profile.notify_email);
      console.log('  follow_up_sms:', profile.follow_up_sms);
      console.log('  is_canary:', profile.is_canary);
      console.log('  notify_days_array:', profile.notify_days_array);
      console.log('');
    });
  }

  // Check if this user appears in report views
  console.log('\n=== REPORT VIEWS (Today\'s cleaning) ===\n');

  const reportViews = ['report_zero_day', 'report_one_day', 'report_follow_up'];

  for (const view of reportViews) {
    try {
      const { data, error } = await supabase
        .from(view)
        .select('*')
        .eq('email', email);

      if (!error && data && data.length > 0) {
        console.log(`✅ Found ${data.length} record(s) in ${view}:`);
        data.forEach((record, idx) => {
          console.log(`  Record ${idx + 1}:`);
          console.log('    User ID:', record.user_id);
          console.log('    Email:', record.email);
          console.log('    Ward/Section:', `${record.home_address_ward}/${record.home_address_section}`);
          console.log('');
        });
      } else if (!error) {
        console.log(`No records in ${view}`);
      }
    } catch (err) {
      console.log(`Could not query ${view}:`, err.message);
    }
  }

  // Check street_cleaning_schedule for today
  console.log('\n=== CHECKING WARD 43, SECTION 1 SCHEDULE ===\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const { data: schedule, error: schedError } = await supabase
    .from('street_cleaning_schedule')
    .select('*')
    .eq('ward', '43')
    .eq('section', '1')
    .eq('cleaning_date', todayStr);

  if (!schedError && schedule) {
    console.log(`Found ${schedule.length} cleaning schedule(s) for today (${todayStr}):`);
    schedule.forEach((s, idx) => {
      console.log(`  Schedule ${idx + 1}: Ward ${s.ward}, Section ${s.section}, Date: ${s.cleaning_date}`);
    });
  } else {
    console.log('No cleaning schedules found for Ward 43, Section 1 today');
  }
}

checkRandyAccount().catch(console.error);
