#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function checkWebhookDeliveries() {
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 1 });

    if (endpoints.data.length === 0) {
      console.log('No webhook endpoints found');
      return;
    }

    const endpoint = endpoints.data[0];
    console.log('Checking webhook:', endpoint.url);
    console.log('Status:', endpoint.status);
    console.log('\nRecent checkout.session.completed events:');

    const events = await stripe.events.list({
      limit: 10,
      type: 'checkout.session.completed'
    });

    for (const event of events.data) {
      const timestamp = new Date(event.created * 1000).toISOString();
      console.log('\n' + timestamp + ' - ' + event.type);
      console.log('Event ID:', event.id);

      // Check if this event was delivered successfully
      try {
        const deliveries = await stripe.webhookEndpoints.listAttempts(endpoint.id, {
          event: event.id,
          limit: 5
        });

        if (deliveries.data.length > 0) {
          deliveries.data.forEach(delivery => {
            const deliveryTime = new Date(delivery.created * 1000).toISOString();
            console.log('  Attempt:', deliveryTime);
            console.log('  Status:', delivery.response_status_code);
            if (delivery.response_status_code >= 400) {
              console.log('  ❌ Error:', delivery.error_message || 'Unknown error');
            } else {
              console.log('  ✅ Success');
            }
          });
        } else {
          console.log('  No delivery attempts found');
        }
      } catch (e) {
        console.log('  Could not fetch delivery attempts:', e.message);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkWebhookDeliveries();
