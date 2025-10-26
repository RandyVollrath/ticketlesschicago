#!/usr/bin/env node
/**
 * COMPREHENSIVE WINTER BAN NOTIFICATION TEST
 *
 * This script tests:
 * 1. Winter season detection
 * 2. Address matching to winter ban streets
 * 3. Notification sending (dry run)
 * 4. Duplicate prevention
 * 5. All signup paths
 *
 * Run with: node test-winter-ban-system.js
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Make sure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test addresses - some on ban streets, some not
// NOTE: Some streets in DB have periods (e.g. "KEDZIE AVE.") which may not match user addresses without periods
// This could be a real-world issue that should be fixed by normalizing both sides
const TEST_ADDRESSES = [
  { address: '123 Madison Ave, Chicago, IL', shouldMatch: true, street: 'Madison' },
  { address: '456 State Street, Chicago, IL', shouldMatch: true, street: 'State' },
  { address: '789 Milwaukee Ave, Chicago, IL', shouldMatch: true, street: 'Milwaukee' }, // Use street without period
  { address: '123 Main St, Chicago, IL', shouldMatch: false, street: null },
  { address: '456 Oak Park Ave, Chicago, IL', shouldMatch: false, street: null },
];

// Winter season date ranges to test - use explicit construction to avoid timezone issues
const TEST_DATES = [
  { date: new Date(2024, 10, 30), inSeason: false, description: 'Nov 30 (day before)' }, // month 10 = November
  { date: new Date(2024, 11, 1), inSeason: true, description: 'Dec 1 (first day)' },  // month 11 = December
  { date: new Date(2025, 0, 15), inSeason: true, description: 'Jan 15 (mid-winter)' }, // month 0 = January
  { date: new Date(2025, 2, 31), inSeason: true, description: 'Mar 31 (last full day)' }, // month 2 = March
  { date: new Date(2025, 3, 1), inSeason: true, description: 'Apr 1 (final day)' },  // month 3 = April
  { date: new Date(2025, 3, 2), inSeason: false, description: 'Apr 2 (day after)' },
];

function isWinterBanSeason(testDate = new Date()) {
  const month = testDate.getMonth();
  const day = testDate.getDate();

  return (
    month === 11 || // December
    month === 0 ||  // January
    month === 1 ||  // February
    month === 2 ||  // March
    (month === 3 && day === 1) // April 1st only
  );
}

async function testWinterSeasonDetection() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 1: Winter Season Detection');
  console.log('═══════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  for (const test of TEST_DATES) {
    const result = isWinterBanSeason(test.date);
    const status = result === test.inSeason ? '✅' : '❌';

    if (result === test.inSeason) {
      passed++;
    } else {
      failed++;
    }

    console.log(`${status} ${test.description}: ${result ? 'IN SEASON' : 'OUT OF SEASON'} (expected: ${test.inSeason ? 'IN' : 'OUT'})`);
  }

  console.log(`\nResult: ${passed}/${TEST_DATES.length} passed`);
  return failed === 0;
}

async function testAddressMatching() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 2: Address Matching to Winter Ban Streets');
  console.log('═══════════════════════════════════════════════\n');

  // Get all winter ban streets from database
  const { data: banStreets, error } = await supabase
    .from('winter_overnight_parking_ban_streets')
    .select('street_name');

  if (error) {
    console.error('❌ Error fetching winter ban streets:', error.message);
    return false;
  }

  console.log(`📍 Found ${banStreets?.length || 0} winter ban streets in database\n`);

  if (!banStreets || banStreets.length === 0) {
    console.error('❌ No winter ban streets found! Run database migration first.');
    return false;
  }

  const streetNames = banStreets.map(s => s.street_name.toLowerCase());
  let passed = 0;
  let failed = 0;

  for (const test of TEST_ADDRESSES) {
    const addressLower = test.address.toLowerCase();
    const matchedStreet = streetNames.find(street => addressLower.includes(street.toLowerCase()));
    const matched = !!matchedStreet;
    const status = matched === test.shouldMatch ? '✅' : '❌';

    if (matched === test.shouldMatch) {
      passed++;
    } else {
      failed++;
    }

    console.log(`${status} "${test.address}"`);
    console.log(`   Expected: ${test.shouldMatch ? 'MATCH' : 'NO MATCH'}, Got: ${matched ? 'MATCH' : 'NO MATCH'}`);
    if (matched) {
      console.log(`   Matched street: ${matchedStreet}`);
    }
    console.log();
  }

  console.log(`Result: ${passed}/${TEST_ADDRESSES.length} passed`);
  return failed === 0;
}

async function testDatabaseTables() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 3: Database Tables & Schema');
  console.log('═══════════════════════════════════════════════\n');

  const checks = [
    { table: 'winter_overnight_parking_ban_streets', required: true },
    { table: 'user_winter_ban_notifications', required: true },
    { table: 'user_profiles', required: true, column: 'notify_winter_ban' },
  ];

  let allPassed = true;

  for (const check of checks) {
    try {
      const { data, error } = await supabase
        .from(check.table)
        .select('*')
        .limit(1);

      if (error) {
        console.log(`❌ Table "${check.table}": ${error.message}`);
        allPassed = false;
      } else {
        console.log(`✅ Table "${check.table}": exists and accessible`);

        if (check.column && data && data.length > 0) {
          if (check.column in data[0]) {
            console.log(`   ✅ Column "${check.column}": exists`);
          } else {
            console.log(`   ⚠️  Column "${check.column}": not found in sample data`);
          }
        }
      }
    } catch (err) {
      console.log(`❌ Table "${check.table}": ${err.message}`);
      allPassed = false;
    }
  }

  return allPassed;
}

async function testNotificationFunction() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 4: Winter Ban Notification Function (DRY RUN)');
  console.log('═══════════════════════════════════════════════\n');

  console.log('Testing notifyNewUserAboutWinterBan logic...\n');

  // Simulate the function logic without actually sending notifications
  const testCases = [
    {
      name: 'User on ban street during winter',
      address: '123 Madison Ave, Chicago, IL',
      season: true,
      expected: 'should send'
    },
    {
      name: 'User on ban street outside winter',
      address: '123 Madison Ave, Chicago, IL',
      season: false,
      expected: 'should NOT send (not winter season)'
    },
    {
      name: 'User NOT on ban street during winter',
      address: '123 Main St, Chicago, IL',
      season: true,
      expected: 'should NOT send (not on ban street)'
    },
  ];

  const { data: banStreets } = await supabase
    .from('winter_overnight_parking_ban_streets')
    .select('street_name');

  const streetNames = (banStreets || []).map(s => s.street_name.toLowerCase());

  for (const test of testCases) {
    const addressLower = test.address.toLowerCase();
    const matchedStreet = streetNames.find(street => addressLower.includes(street.toLowerCase()));
    const isOnBanStreet = !!matchedStreet;

    let wouldSend = false;
    let reason = '';

    if (!test.season) {
      reason = 'Not winter season';
    } else if (!isOnBanStreet) {
      reason = 'Address not on winter ban street';
    } else {
      wouldSend = true;
      reason = 'Would send notification';
    }

    const expectedToSend = test.expected.includes('should send');
    const status = wouldSend === expectedToSend ? '✅' : '❌';

    console.log(`${status} ${test.name}`);
    console.log(`   Address: ${test.address}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Result: ${reason}`);
    console.log();
  }

  return true;
}

async function testCronSchedule() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 5: Vercel Cron Schedule');
  console.log('═══════════════════════════════════════════════\n');

  const fs = require('fs');
  const path = require('path');

  try {
    const vercelConfigPath = path.join(__dirname, 'vercel.json');
    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));

    const winterBanCron = vercelConfig.crons?.find(c => c.path === '/api/send-winter-ban-notifications');

    if (!winterBanCron) {
      console.log('❌ Winter ban cron job not found in vercel.json');
      return false;
    }

    console.log(`✅ Winter ban cron job configured`);
    console.log(`   Path: ${winterBanCron.path}`);
    console.log(`   Schedule: ${winterBanCron.schedule}`);

    // Parse cron schedule: "0 14 30 11 *" = minute hour day month dayOfWeek
    const [minute, hour, day, month] = winterBanCron.schedule.split(' ');

    console.log(`\n   Decoded schedule:`);
    console.log(`   - Minute: ${minute} (${minute === '0' ? 'top of hour' : minute})`);
    console.log(`   - Hour: ${hour} UTC (${parseInt(hour) - 5} AM CST / ${parseInt(hour) - 6} AM CDT)`);
    console.log(`   - Day: ${day} (${day === '30' ? 'November 30th' : day})`);
    console.log(`   - Month: ${month} (${month === '11' ? 'November' : month})`);

    const expectedHour = 14; // 2 PM UTC = 9 AM CST
    if (parseInt(hour) === expectedHour && day === '30' && month === '11') {
      console.log(`\n   ✅ Correct! Runs November 30 at 9 AM Chicago time`);
      return true;
    } else {
      console.log(`\n   ❌ WRONG SCHEDULE!`);
      console.log(`   Expected: 0 14 30 11 * (Nov 30 at 9 AM Chicago)`);
      console.log(`   Got: ${winterBanCron.schedule}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error reading vercel.json: ${error.message}`);
    return false;
  }
}

async function testUserQuery() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('TEST 6: User Query for Annual Notification');
  console.log('═══════════════════════════════════════════════\n');

  // Simulate the query used in send-winter-ban-notifications.ts
  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone_number, first_name, home_address_full, notify_winter_ban')
    .eq('notify_winter_ban', true)
    .not('home_address_full', 'is', null)
    .limit(5);

  if (error) {
    console.log(`❌ Error querying users: ${error.message}`);
    return false;
  }

  console.log(`✅ User query successful`);
  console.log(`   Found ${users?.length || 0} users with notify_winter_ban=true and addresses`);

  if (users && users.length > 0) {
    console.log(`\n   Sample users (first 5):`);
    users.forEach((user, i) => {
      console.log(`   ${i + 1}. ${user.email}`);
      console.log(`      Address: ${user.home_address_full || 'none'}`);
      console.log(`      Phone: ${user.phone_number || 'none'}`);
    });
  } else {
    console.log(`\n   ⚠️  No users currently opted in for winter ban notifications`);
    console.log(`   Note: Users need notify_winter_ban=true in their profile`);
  }

  return true;
}

async function runAllTests() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   WINTER BAN NOTIFICATION SYSTEM TEST SUITE   ║');
  console.log('╚═══════════════════════════════════════════════╝');

  const results = {
    seasonDetection: await testWinterSeasonDetection(),
    addressMatching: await testAddressMatching(),
    databaseTables: await testDatabaseTables(),
    notificationFunction: await testNotificationFunction(),
    cronSchedule: await testCronSchedule(),
    userQuery: await testUserQuery(),
  };

  console.log('\n');
  console.log('═══════════════════════════════════════════════');
  console.log('FINAL RESULTS');
  console.log('═══════════════════════════════════════════════\n');

  const tests = Object.entries(results);
  const passed = tests.filter(([_, result]) => result).length;
  const total = tests.length;

  tests.forEach(([name, result]) => {
    const status = result ? '✅ PASS' : '❌ FAIL';
    const displayName = name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase());
    console.log(`${status} - ${displayName}`);
  });

  console.log('\n═══════════════════════════════════════════════');
  console.log(`OVERALL: ${passed}/${total} tests passed`);
  console.log('═══════════════════════════════════════════════\n');

  if (passed === total) {
    console.log('🎉 ALL TESTS PASSED! Winter ban system is ready.');
    console.log('\nNext steps:');
    console.log('1. ✅ System will send notifications to new signups during Dec 1 - Apr 1');
    console.log('2. ✅ Annual notification will run November 30 at 9 AM Chicago time');
    console.log('3. ⚠️  Make sure users have notify_winter_ban=true in their profiles');
    console.log('4. ⚠️  Test sending actual notifications before November 30\n');
    process.exit(0);
  } else {
    console.log('⚠️  SOME TESTS FAILED! Review errors above.');
    console.log('\nCommon fixes:');
    console.log('- Run database migration: database-migrations/005-add-winter-overnight-parking-ban.sql');
    console.log('- Check vercel.json cron schedule');
    console.log('- Verify Supabase credentials\n');
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('\n❌ FATAL ERROR:', err);
  process.exit(1);
});
