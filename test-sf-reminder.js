#!/usr/bin/env node

/**
 * Test SF Street Cleaning Reminder System
 *
 * This script simulates the SF reminder cron and tests with a sample user
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testSFReminder() {
  console.log('🧪 Testing SF Street Cleaning Reminder System\n');

  // 1. Check if city/timezone columns exist
  console.log('1️⃣  Checking database schema...');
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('city, timezone')
    .limit(1)
    .single();

  if (profileError && profileError.code !== 'PGRST116') {
    console.error('❌ Error checking schema:', profileError.message);
    if (profileError.message.includes('column') && profileError.message.includes('does not exist')) {
      console.log('\n⚠️  You need to run the migration SQL first!');
      console.log('Run this in Supabase SQL Editor:');
      console.log('```sql');
      console.log(require('fs').readFileSync('./database/add-city-and-timezone.sql', 'utf-8'));
      console.log('```\n');
    }
    return;
  }

  console.log('✅ Schema looks good!\n');

  // 2. Check for SF street sweeping data
  console.log('2️⃣  Checking SF street sweeping data...');
  const { data: schedules, error: schedError } = await supabase
    .from('sf_street_sweeping')
    .select('*')
    .limit(5);

  if (schedError) {
    console.error('❌ Error fetching SF schedules:', schedError.message);
    return;
  }

  console.log(`✅ Found ${schedules?.length || 0} SF street segments (showing first 5)`);
  if (schedules && schedules.length > 0) {
    schedules.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.corridor} - ${s.full_name} ${s.from_hour}:00-${s.to_hour}:00`);
    });
  }
  console.log();

  // 3. Check for SF users
  console.log('3️⃣  Checking for SF users...');
  const { data: sfUsers, error: userError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('city', 'san-francisco');

  if (userError) {
    console.error('❌ Error fetching SF users:', userError.message);
    return;
  }

  console.log(`Found ${sfUsers?.length || 0} SF users`);
  if (sfUsers && sfUsers.length > 0) {
    sfUsers.forEach(u => {
      console.log(`   - ${u.email} (${u.home_address || 'no address'})`);
    });
  } else {
    console.log('⚠️  No SF users found. You need to create a test user!');
  }
  console.log();

  // 4. Test reminder API
  console.log('4️⃣  Testing SF reminder API...');
  try {
    const response = await fetch('http://localhost:3001/api/sf-street-cleaning/process');
    const result = await response.json();

    console.log('API Response:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`✅ API call successful!`);
      console.log(`   Processed: ${result.processed}`);
      console.log(`   Successful: ${result.successful}`);
      console.log(`   Failed: ${result.failed}`);
      console.log(`   Type: ${result.type}`);
    } else {
      console.error('❌ API call failed:', result.error);
    }
  } catch (err) {
    console.error('❌ Error calling API:', err.message);
    console.log('\n⚠️  Make sure dev server is running: npm run dev');
  }
  console.log();

  // 5. Summary
  console.log('📊 Summary:');
  console.log('   ✅ Database schema: Ready');
  console.log(`   ${schedules && schedules.length > 0 ? '✅' : '❌'} SF street data: ${schedules?.length || 0} records`);
  console.log(`   ${sfUsers && sfUsers.length > 0 ? '✅' : '⚠️ '} SF users: ${sfUsers?.length || 0} users`);
  console.log();

  if (!sfUsers || sfUsers.length === 0) {
    console.log('🎯 Next Steps:');
    console.log('   1. Create a test SF user in Supabase:');
    console.log('      UPDATE user_profiles SET city = \'san-francisco\', home_address = \'123 Market St, San Francisco, CA\' WHERE email = \'your-email@example.com\';');
    console.log('   2. Run this test again');
  }
}

testSFReminder()
  .then(() => {
    console.log('✅ Test complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
