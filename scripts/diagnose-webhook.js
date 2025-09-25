#!/usr/bin/env node

console.log('🔍 WEBHOOK DIAGNOSTIC');
console.log('===================\n');

console.log('📊 EXPECTED WEBHOOK CONFIGURATION:');
console.log('   URL: https://ticketlessamerica.com/api/stripe-webhook');
console.log('   Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted');
console.log('   Status: Active');

console.log('\n❓ COMMON WEBHOOK ISSUES:');
console.log('1. ❌ Webhook URL is wrong or unreachable');
console.log('2. ❌ Webhook secret mismatch (we regenerated it)');
console.log('3. ❌ Events not configured correctly');
console.log('4. ❌ Webhook is disabled or failing');
console.log('5. ❌ Vercel function timeout/error');

console.log('\n🔧 DEBUGGING STEPS:');
console.log('1. Check Stripe Dashboard → Developers → Webhooks');
console.log('2. Look for webhook delivery attempts around Sep 24, 5:01 PM');
console.log('3. Check delivery status (succeeded/failed)');
console.log('4. If failed, check error message');
console.log('5. If succeeded, check Vercel function logs');

console.log('\n🎯 LIKELY CAUSES:');
console.log('Given that payment succeeded but no data saved:');
console.log('• Webhook was not delivered by Stripe');
console.log('• Webhook was delivered but failed to process');
console.log('• Form data was not included in Stripe metadata');

console.log('\n💡 IMMEDIATE FIXES:');
console.log('1. Recover this user manually with recovery script');
console.log('2. Check webhook configuration in Stripe');
console.log('3. Update webhook secret if needed');
console.log('4. Test with a new signup to verify fix');

console.log('\n🚀 TO RECOVER USER:');
console.log('   npm run dev  # In another terminal');
console.log('   node scripts/recover-paid-user.js');

console.log('\n📋 NEXT: Check Stripe webhook dashboard and report findings!');