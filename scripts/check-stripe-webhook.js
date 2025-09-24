#!/usr/bin/env node

// Check Stripe webhook configuration
require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function checkWebhooks() {
  console.log('Checking Stripe Webhook Configuration');
  console.log('=====================================\n');
  
  try {
    // List all webhooks
    const webhookEndpoints = await stripe.webhookEndpoints.list({
      limit: 10
    });
    
    if (webhookEndpoints.data.length === 0) {
      console.log('❌ No webhook endpoints configured in Stripe!');
      console.log('\n⚠️  You need to configure a webhook endpoint in Stripe:');
      console.log('1. Go to https://dashboard.stripe.com/webhooks');
      console.log('2. Click "Add endpoint"');
      console.log('3. Enter your endpoint URL (e.g., https://ticketlessamerica.com/api/stripe-webhook)');
      console.log('4. Select events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted');
      console.log('5. Copy the webhook secret and add it to STRIPE_WEBHOOK_SECRET in .env.local');
    } else {
      console.log(`✅ Found ${webhookEndpoints.data.length} webhook endpoint(s):\n`);
      
      webhookEndpoints.data.forEach((endpoint, index) => {
        console.log(`Endpoint ${index + 1}:`);
        console.log(`  URL: ${endpoint.url}`);
        console.log(`  Status: ${endpoint.status}`);
        console.log(`  Events: ${endpoint.enabled_events.join(', ')}`);
        console.log(`  Created: ${new Date(endpoint.created * 1000).toLocaleString()}`);
        console.log('');
      });
    }
    
    // Check recent events
    console.log('\n📊 Recent Webhook Events (last 5):');
    console.log('===================================\n');
    
    const events = await stripe.events.list({
      limit: 5
    });
    
    if (events.data.length === 0) {
      console.log('No recent events');
    } else {
      events.data.forEach(event => {
        console.log(`${new Date(event.created * 1000).toLocaleString()} - ${event.type}`);
        if (event.type === 'checkout.session.completed') {
          console.log(`  Session ID: ${event.data.object.id}`);
          console.log(`  Customer: ${event.data.object.customer_details?.email}`);
        }
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.log('\n💡 Make sure your Stripe API keys are configured correctly in .env.local');
  }
}

checkWebhooks();