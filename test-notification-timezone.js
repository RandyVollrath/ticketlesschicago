#!/usr/bin/env node

/**
 * Test script to verify timezone conversion is working correctly
 * for street cleaning notifications
 * Run with: node test-notification-timezone.js
 */

// Simulate Vercel's UTC environment
process.env.TZ = 'UTC';

console.log('🧪 Testing Timezone Conversion Fix\n');
console.log('Server timezone:', process.env.TZ);
console.log('='.repeat(60));

// OLD BROKEN WAY (what was causing 6am notifications)
function getChicagoTimeOLD(testDate) {
  const now = testDate || new Date();
  const chicagoTime = now.toLocaleString("en-US", { timeZone: "America/Chicago" });
  const chicagoDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hour = chicagoDate.getHours();

  return { hour, chicagoTime, method: 'OLD (BROKEN)' };
}

// NEW CORRECT WAY
function getChicagoTimeNEW(testDate) {
  const now = testDate || new Date();
  const chicagoTime = now.toLocaleString("en-US", { timeZone: "America/Chicago" });

  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }).format(now)
  );

  return { hour, chicagoTime, method: 'NEW (FIXED)' };
}

// Test cases
const testCases = [
  { utc: '2025-11-12T12:00:00Z', expectedChicagoHour: 6, description: '6am Chicago (CST)' },
  { utc: '2025-11-12T13:00:00Z', expectedChicagoHour: 7, description: '7am Chicago (CST)' },
  { utc: '2025-11-12T21:00:00Z', expectedChicagoHour: 15, description: '3pm Chicago (CST)' },
  { utc: '2025-11-13T01:00:00Z', expectedChicagoHour: 19, description: '7pm Chicago (CST)' },
  // Test during Daylight Saving Time
  { utc: '2025-06-12T11:00:00Z', expectedChicagoHour: 6, description: '6am Chicago (CDT - summer)' },
  { utc: '2025-06-12T12:00:00Z', expectedChicagoHour: 7, description: '7am Chicago (CDT - summer)' },
];

console.log('\n📋 Test Results:\n');

let passCount = 0;
let failCount = 0;

testCases.forEach((testCase, index) => {
  const testDate = new Date(testCase.utc);
  const oldResult = getChicagoTimeOLD(testDate);
  const newResult = getChicagoTimeNEW(testDate);

  const oldPass = oldResult.hour === testCase.expectedChicagoHour;
  const newPass = newResult.hour === testCase.expectedChicagoHour;

  console.log(`Test ${index + 1}: ${testCase.description}`);
  console.log(`  UTC Time: ${testCase.utc}`);
  console.log(`  Expected Chicago Hour: ${testCase.expectedChicagoHour}`);
  console.log(`  OLD method: ${oldResult.hour} ${oldPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  NEW method: ${newResult.hour} ${newPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');

  if (newPass) passCount++;
  else failCount++;
});

console.log('='.repeat(60));
console.log(`\n📊 Summary: ${passCount} passed, ${failCount} failed`);

if (failCount === 0) {
  console.log('\n✅ All tests passed! The timezone fix is working correctly.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed. The fix needs more work.');
  process.exit(1);
}
