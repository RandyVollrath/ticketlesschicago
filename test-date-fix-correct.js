#!/usr/bin/env node

// Test that the date fix works correctly with proper timezone handling
console.log('Testing date calculation fix with Chicago timezone:\n');

// The issue: dates like "2025-09-30" are parsed as UTC midnight
// But we need to compare them in local time context

console.log('❌ THE BUG:');
const nowBuggy = new Date('2025-09-29T14:00:20.379Z'); // 9 AM Chicago = 14:00 UTC
const dueDateBuggy = new Date('2025-09-30'); // Parsed as 2025-09-30T00:00:00.000Z
const hoursDiff = (dueDateBuggy.getTime() - nowBuggy.getTime()) / (1000 * 60 * 60);
console.log(`  Current: ${nowBuggy.toISOString()} (9 AM Chicago)`);
console.log(`  Due date: ${dueDateBuggy.toISOString()}`);
console.log(`  Hours until: ${hoursDiff.toFixed(1)} hours`);
console.log(`  Days (floor): ${Math.floor(hoursDiff / 24)} <- Bug! Shows 0 instead of 1`);

console.log('\n✅ THE FIX:');
// Create dates and normalize both to start of day
const today = new Date('2025-09-29T14:00:20.379Z');
const tomorrow = new Date('2025-09-30');

// Method 1: Set both to UTC midnight
today.setUTCHours(0, 0, 0, 0);
tomorrow.setUTCHours(0, 0, 0, 0);

const daysUntil = Math.floor((tomorrow.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
console.log(`  Today (normalized): ${today.toISOString()}`);
console.log(`  Tomorrow (normalized): ${tomorrow.toISOString()}`);
console.log(`  Days until: ${daysUntil} <- Correct! Shows 1 day`);

console.log('\n📊 Randy\'s actual dates:');
const testToday = new Date();
testToday.setUTCHours(0, 0, 0, 0);

const randyDates = {
  citySticker: '2025-09-30',
  licensePlate: '2025-10-29', 
  emissions: '2025-11-28'
};

const reminderDays = [60, 30, 14, 7, 3, 1];

for (const [type, dateStr] of Object.entries(randyDates)) {
  const dueDate = new Date(dateStr);
  dueDate.setUTCHours(0, 0, 0, 0);
  const days = Math.floor((dueDate.getTime() - testToday.getTime()) / (1000 * 60 * 60 * 24));
  const willSend = reminderDays.includes(days);
  console.log(`  ${type}: ${dateStr} (${days} days) - ${willSend ? '✅ Will send reminder' : '⏳ No reminder today'}`);
}