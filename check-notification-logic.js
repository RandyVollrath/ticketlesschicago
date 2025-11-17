// Quick script to check notification logic for Randy

// Simulate different scenarios
function checkNotificationMessage(daysUntil, hasProtection, renewalType, canAutoPurchase) {
  console.log(`\n📅 Scenario: ${renewalType}, ${daysUntil} days until expiry`);
  console.log(`   Protection: ${hasProtection}, Can Auto-Purchase: ${canAutoPurchase}`);

  let message = '';

  if (!hasProtection || !canAutoPurchase) {
    // Free user OR emissions test
    if (daysUntil === 0) {
      message = `Your ${renewalType} ${renewalType === 'Emissions Test' ? 'is' : 'expires'} due TODAY`;
    } else if (daysUntil === 1) {
      message = `Your ${renewalType} ${renewalType === 'Emissions Test' ? 'is' : 'expires'} due TOMORROW`;
    } else if (daysUntil <= 7) {
      message = `Your ${renewalType} ${renewalType === 'Emissions Test' ? 'is' : 'expires'} due in ${daysUntil} days`;
    } else {
      message = `Your ${renewalType} expires in ${daysUntil} days`;
    }
  } else {
    // Protection user with auto-purchasable item
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + daysUntil);
    const purchaseDate = new Date(dueDate);
    purchaseDate.setDate(purchaseDate.getDate() - 30);

    if (daysUntil === 30) {
      message = `We're charging your card TODAY for your ${renewalType} renewal`;
    } else if (daysUntil === 37) {
      message = `We'll charge your card in 7 days for your ${renewalType}`;
    } else if (daysUntil > 37) {
      message = `We'll charge your card on ${purchaseDate.toLocaleDateString()} for your ${renewalType}`;
    } else if (daysUntil >= 14) {
      message = `✅ TRIGGER: We already purchased your ${renewalType}`;
    } else {
      message = `Your ${renewalType} sticker should arrive soon`;
    }
  }

  console.log(`   Message: "${message}"`);
}

console.log('🔔 NOTIFICATION LOGIC TEST');
console.log('==========================');

// Test City Sticker scenarios for Protection user
console.log('\n--- CITY STICKER (Protection User) ---');
checkNotificationMessage(60, true, 'City Sticker', true);
checkNotificationMessage(45, true, 'City Sticker', true);
checkNotificationMessage(37, true, 'City Sticker', true);
checkNotificationMessage(30, true, 'City Sticker', true);
checkNotificationMessage(25, true, 'City Sticker', true); // <-- "already purchased" range
checkNotificationMessage(20, true, 'City Sticker', true); // <-- "already purchased" range
checkNotificationMessage(15, true, 'City Sticker', true); // <-- "already purchased" range
checkNotificationMessage(14, true, 'City Sticker', true); // <-- "already purchased" range
checkNotificationMessage(13, true, 'City Sticker', true);
checkNotificationMessage(7, true, 'City Sticker', true);

// Test Emissions Test scenarios (should NEVER say "already purchased")
console.log('\n--- EMISSIONS TEST (Protection User) ---');
checkNotificationMessage(30, true, 'Emissions Test', false);
checkNotificationMessage(20, true, 'Emissions Test', false); // Should NOT say "already purchased"
checkNotificationMessage(14, true, 'Emissions Test', false); // Should NOT say "already purchased"
checkNotificationMessage(7, true, 'Emissions Test', false);

console.log('\n📊 SUMMARY:');
console.log('===========');
console.log('✅ City Sticker (14-29 days): "We already purchased" message');
console.log('   - This is CORRECT if you\'re a Protection user');
console.log('   - Assumes purchase happened 30 days before expiry');
console.log('');
console.log('✅ Emissions Test (any days): Reminder message ONLY');
console.log('   - NEVER says "already purchased"');
console.log('   - Always says "schedule your test"');
console.log('');
console.log('🎯 To see what triggered YOUR message:');
console.log('   1. What is your city_sticker_expiry date?');
console.log('   2. Calculate: days until that date');
console.log('   3. If between 14-29 days → "already purchased" message');
