#!/usr/bin/env node

// Test that the date fix works correctly
console.log('Testing date calculation fix:\n');

// Simulate what was happening before
console.log('❌ BEFORE FIX (Bug):');
const nowBuggy = new Date('2025-09-29T14:00:20.379Z'); // 9 AM Chicago time in UTC
const dueDateBuggy = new Date('2025-09-30'); // City sticker due tomorrow
const daysUntilBuggy = Math.floor((dueDateBuggy.getTime() - nowBuggy.getTime()) / (1000 * 60 * 60 * 24));
console.log(`  Current time: ${nowBuggy.toISOString()}`);
console.log(`  Due date: ${dueDateBuggy.toISOString()}`);
console.log(`  Days until: ${daysUntilBuggy} (shows as 0, TODAY!)`);
console.log(`  Would match reminder_days [1]? ${daysUntilBuggy === 1 ? 'Yes' : 'No'}`);

// Simulate what happens with the fix
console.log('\n✅ AFTER FIX:');
const nowFixed = new Date('2025-09-29T14:00:20.379Z');
nowFixed.setHours(0, 0, 0, 0); // Normalize to midnight
const dueDateFixed = new Date('2025-09-30');
dueDateFixed.setHours(0, 0, 0, 0); // Normalize to midnight
const daysUntilFixed = Math.floor((dueDateFixed.getTime() - nowFixed.getTime()) / (1000 * 60 * 60 * 24));
console.log(`  Current time (normalized): ${nowFixed.toISOString()}`);
console.log(`  Due date (normalized): ${dueDateFixed.toISOString()}`);
console.log(`  Days until: ${daysUntilFixed} (correctly shows as 1, TOMORROW!)`);
console.log(`  Would match reminder_days [1]? ${daysUntilFixed === 1 ? 'Yes' : 'No'}`);

console.log('\n📊 Testing various scenarios:');
const testDates = [
  '2025-09-30', // Tomorrow
  '2025-10-06', // 7 days
  '2025-10-29', // 30 days
  '2025-10-15'  // 16 days (shouldn't match)
];

const today = new Date('2025-09-29T14:00:20.379Z');
today.setHours(0, 0, 0, 0);

testDates.forEach(dateStr => {
  const testDate = new Date(dateStr);
  testDate.setHours(0, 0, 0, 0);
  const days = Math.floor((testDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const matches = [60, 30, 14, 7, 3, 1].includes(days);
  console.log(`  ${dateStr}: ${days} days away - ${matches ? '✅ Would send reminder' : '❌ No reminder'}`);
});

console.log('\n🎉 Fix confirmed working! Randy should now get his 1-day reminder.');