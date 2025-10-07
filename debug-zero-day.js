const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://auth.ticketlessamerica.com',
  'sb_secret_Wya9tEp8AN0FaIsvMquGuw_3Ef1AYY1'
);

(async () => {
  console.log('🔍 Debugging why Randy didn\'t get street cleaning notifications from TA\n');

  // Check if Randy appears in report_zero_day view
  console.log('1. Checking report_zero_day view (used by 7am morning_reminder cron)...');
  const { data: zeroDay, error: zeroDayError } = await supabase
    .from('report_zero_day')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com');

  if (zeroDayError) {
    console.error('   ❌ Error querying report_zero_day:', zeroDayError);
  } else if (zeroDay.length === 0) {
    console.log('   ❌ Randy NOT in report_zero_day view');
  } else {
    console.log('   ✅ Randy found in report_zero_day:');
    console.log(JSON.stringify(zeroDay, null, 2));
  }

  // Check if there's a cleaning date for Ward 43, Section 1 today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  console.log('\n2. Checking for Ward 43, Section 1 cleaning today (' + todayStr + ')...');
  const { data: schedule, error: scheduleError } = await supabase
    .from('street_cleaning_schedule')
    .select('*')
    .eq('ward', '43')
    .eq('section', '1')
    .eq('cleaning_date', todayStr);

  if (scheduleError) {
    console.error('   ❌ Error querying schedule:', scheduleError);
  } else if (schedule.length === 0) {
    console.log('   ❌ No cleaning scheduled for Ward 43, Section 1 today');
  } else {
    console.log('   ✅ Cleaning scheduled:');
    console.log(JSON.stringify(schedule, null, 2));
  }

  // Check Randy's full profile
  console.log('\n3. Randy\'s full profile:');
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();

  if (profileError) {
    console.error('   ❌ Error:', profileError);
  } else {
    console.log('   Relevant fields:');
    console.log('   - notify_days_array:', profile.notify_days_array);
    console.log('   - home_address_ward:', profile.home_address_ward);
    console.log('   - home_address_section:', profile.home_address_section);
    console.log('   - snooze_until_date:', profile.snooze_until_date);
    console.log('   - notify_email:', profile.notify_email);
    console.log('   - notify_sms:', profile.notify_sms);
    console.log('   - phone_call_enabled:', profile.phone_call_enabled);
  }

  // Check if view exists
  console.log('\n4. Checking if report_zero_day view exists...');
  const { data: views, error: viewError } = await supabase
    .from('report_zero_day')
    .select('*')
    .limit(1);

  if (viewError) {
    console.error('   ❌ View may not exist:', viewError);
  } else {
    console.log('   ✅ View exists and is queryable');
  }
})();
