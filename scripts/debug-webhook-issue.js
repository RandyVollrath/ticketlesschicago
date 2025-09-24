#!/usr/bin/env node

// Debug why webhook isn't saving user data
require('dotenv').config({ path: '.env.local' });

console.log('🔍 Debugging Webhook Data Saving Issue');
console.log('=====================================\n');

console.log('❓ POSSIBLE ISSUES:');
console.log('1. Stripe webhook not being called');
console.log('2. Webhook signature verification failing');
console.log('3. Form data not passed in Stripe metadata');
console.log('4. User created but webhook fails to save vehicle data');
console.log('5. Database errors during data saving');

console.log('\n🧪 DEBUGGING STEPS:');
console.log('1. Check if chicagoentrepretour@gmail.com completed payment');
console.log('2. Check Stripe dashboard for webhook delivery status');
console.log('3. Check Vercel logs for webhook processing');
console.log('4. Test webhook manually with mock data');

console.log('\n📊 USER STATUS:');
console.log('✅ User exists in Supabase auth');
console.log('❌ No vehicle data saved');
console.log('❌ No profile data saved');
console.log('❌ No obligations created');

console.log('\n🔧 LIKELY CAUSE:');
console.log('The Stripe checkout session either:');
console.log('- Did not complete payment successfully');
console.log('- Completed payment but webhook was not triggered');
console.log('- Webhook was triggered but failed to process');

console.log('\n🎯 NEXT STEPS:');
console.log('1. Check Stripe dashboard for successful payments');
console.log('2. Check webhook delivery logs in Stripe');
console.log('3. Check Vercel function logs');
console.log('4. Test webhook manually if needed');

console.log('\nTo test webhook manually:');
console.log('node scripts/fix-existing-user.js chicagoentrepretour@gmail.com');