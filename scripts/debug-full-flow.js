#!/usr/bin/env node

console.log('🔍 FULL DATA FLOW DEBUG\n');
console.log('=== PROBLEM: Fields not saving ===');
console.log('❌ Vehicle year: Shows wrong year');
console.log('❌ 60-day reminder: Not checked');
console.log('❌ Renewal dates: Empty');
console.log('❌ Phone number: Missing\n');

console.log('=== STEP 1: Homepage Form ===');
console.log('Form initial state:');
console.log('- reminderDays: [30, 7, 1] // MISSING 60!');
console.log('- vehicleYear: new Date().getFullYear() // 2025');
console.log('✅ User fills form and changes values\n');

console.log('=== STEP 2: Create Checkout ===');
console.log('Form data sent to /api/create-checkout:');
console.log('- All form fields passed in body');
console.log('- Data split into 4 metadata chunks for Stripe\n');

console.log('=== STEP 3: Stripe Webhook ===');
console.log('Webhook receives metadata and parses:');
console.log(`
const vehicleInfo = JSON.parse(metadata.vehicleInfo);
// Contains: name, licensePlate, vin, zipCode, vehicleType, vehicleYear

const renewalDates = JSON.parse(metadata.renewalDates);  
// Contains: cityStickerExpiry, licensePlateExpiry, emissionsDate

const preferences = JSON.parse(metadata.preferences);
// Contains: reminderDays, emailNotifications, smsNotifications, etc.
`);

console.log('=== STEP 4: Database Insert ===');
console.log('Webhook saves to users table:');
console.log(`
.from('users').insert({
  vehicle_year: formData.vehicleYear,  // ✅ Should work
  city_sticker_expiry: formData.cityStickerExpiry, // ✅ Should work
  notification_preferences: {
    reminder_days: formData.reminderDays // ✅ Should include user's selections
  }
})
`);

console.log('\n🔴 LIKELY ISSUE: Form values not persisting to Stripe metadata!');
console.log('User changes values but they might not save to formData state');
console.log('OR values are lost during the checkout redirect\n');

console.log('💡 SOLUTION: Add logging to see actual values:');
console.log('1. Log formData right before checkout');
console.log('2. Log metadata received in webhook');
console.log('3. Compare to find where data is lost');