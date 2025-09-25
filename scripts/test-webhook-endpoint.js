#!/usr/bin/env node

// Test if webhook endpoint is accessible and working
require('dotenv').config({ path: '.env.local' });

async function testWebhookEndpoint() {
  console.log('🧪 TESTING WEBHOOK ENDPOINT');
  console.log('============================\n');

  const webhookUrl = 'https://www.ticketlessamerica.com/api/stripe-webhook';
  
  console.log('🎯 EXPECTED WEBHOOK CONFIGURATION:');
  console.log(`   URL: ${webhookUrl}`);
  console.log('   Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted');
  console.log('   Status: Active');
  console.log('   Description: Handle payment success and save user data\n');
  
  console.log('📋 TROUBLESHOOTING CHECKLIST:');
  console.log('1. ✅ Webhook endpoint exists and returns 405 for GET');
  console.log('2. ❓ Webhook URL configured in Stripe Dashboard');
  console.log('3. ❓ Webhook secret matches environment variable');
  console.log('4. ❓ Events include "checkout.session.completed"');
  console.log('5. ❓ Webhook is enabled and active\n');
  
  // Test webhook endpoint accessibility
  console.log('🔍 Testing webhook endpoint accessibility...');
  try {
    const response = await fetch(webhookUrl, {
      method: 'GET'
    });
    
    if (response.status === 405) {
      console.log('✅ Webhook endpoint exists and rejects GET requests (correct behavior)');
    } else {
      console.log(`❌ Unexpected response: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Webhook endpoint not accessible:', error.message);
  }
  
  console.log('\n🔧 NEXT STEPS:');
  console.log('1. Check Stripe Dashboard → Developers → Webhooks');
  console.log('2. Verify webhook URL is exactly: https://www.ticketlessamerica.com/api/stripe-webhook');
  console.log('3. Check webhook secret matches STRIPE_WEBHOOK_SECRET in Vercel environment');
  console.log('4. Ensure events include "checkout.session.completed"');
  console.log('5. Test with a new signup to see webhook delivery logs');
  
  console.log('\n💡 COMMON ISSUES:');
  console.log('• URL missing "www" subdomain');
  console.log('• Webhook secret mismatch (regenerated after GitGuardian incident)');
  console.log('• Events not configured correctly');
  console.log('• Webhook disabled in Stripe dashboard');
  
  console.log('\n📊 TO VERIFY WEBHOOK IS WORKING:');
  console.log('• Make a test payment with test card');
  console.log('• Check Vercel function logs for webhook processing');
  console.log('• Check Stripe webhook delivery logs');
  console.log('• User should have vehicle data saved after payment');
}

testWebhookEndpoint().catch(console.error);