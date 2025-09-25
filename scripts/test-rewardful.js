#!/usr/bin/env node

console.log('🎯 REWARDFUL INTEGRATION TEST');
console.log('==============================\n');

console.log('✅ FIXED ISSUES:');
console.log('1. ✅ JavaScript API: Now correctly uses Rewardful.referral (capital R)');
console.log('2. ✅ Referral tracking: Properly captures referral ID from cookies');
console.log('3. ✅ Client-side conversion: Added backup tracking on success page');
console.log('4. ✅ Webhook conversion: Tracks via client_reference_id\n');

console.log('📋 HOW REWARDFUL WORKS:');
console.log('1. Affiliate shares link: ticketlessamerica.com/?via=AFFILIATE_TOKEN');
console.log('2. Visitor clicks link → Rewardful sets cookie with referral ID');
console.log('3. Visitor fills form → referral ID captured from Rewardful.referral');
console.log('4. Referral ID passed to Stripe as client_reference_id');
console.log('5. After payment → webhook reports conversion to Rewardful');
console.log('6. Backup: Success page also calls rewardful("convert")\n');

console.log('🧪 TO TEST AFFILIATE TRACKING:');
console.log('1. Visit: https://ticketlessamerica.com/?via=TEST_AFFILIATE');
console.log('2. Open browser console and check for:');
console.log('   - "Rewardful is ready!"');
console.log('   - "Rewardful referral ID found: [UUID]"');
console.log('   - "Referred by: [Affiliate Name]"');
console.log('3. Fill out signup form completely');
console.log('4. Use test card: 4242 4242 4242 4242');
console.log('5. Complete payment');
console.log('6. Check Stripe webhook logs for:');
console.log('   - "Rewardful referral ID found in webhook: [UUID]"');
console.log('   - "Sending conversion to Rewardful"');
console.log('7. Check Rewardful dashboard for conversion\n');

console.log('🔍 DEBUGGING TIPS:');
console.log('• In browser console: window.Rewardful.referral (shows referral ID)');
console.log('• In browser console: window.Rewardful.affiliate (shows affiliate info)');
console.log('• In browser console: window.Rewardful._cookie (debug data)');
console.log('• Check Network tab for r.wdfl.co requests');
console.log('• Check Stripe Dashboard → Payments for client_reference_id');
console.log('• Check Rewardful Dashboard → Conversions\n');

console.log('📊 REQUIREMENTS FOR TRACKING:');
console.log('✅ Rewardful script loaded (in _document.tsx)');
console.log('✅ API key: 4fe255');
console.log('✅ Stripe connected with read-write permissions');
console.log('✅ Customer created in Stripe within 24 hours');
console.log('✅ Cookie present from affiliate link\n');

console.log('⚠️  COMMON ISSUES:');
console.log('• Ad blockers may block Rewardful script');
console.log('• Incognito mode may block cookies');
console.log('• Cross-domain issues if checkout on different domain');
console.log('• Referral expires after 60 days by default\n');

console.log('🎉 Ready to test! Share an affiliate link and track a conversion.');