#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function fixWebhookUrl() {
  try {
    console.log('Checking Stripe webhook configuration...\n');

    // Get current webhooks
    const endpoints = await stripe.webhookEndpoints.list({ limit: 10 });

    if (endpoints.data.length === 0) {
      console.log('No webhooks found.');
      return;
    }

    console.log('Current webhooks:');
    endpoints.data.forEach((endpoint, index) => {
      console.log(`\n${index + 1}. ID: ${endpoint.id}`);
      console.log(`   URL: ${endpoint.url}`);
      console.log(`   Status: ${endpoint.status}`);
      console.log(`   Events: ${endpoint.enabled_events.join(', ')}`);
    });

    // Check if any are using the non-www URL (which causes redirects)
    const problematicEndpoints = endpoints.data.filter(e =>
      e.url.includes('//ticketlessamerica.com/') && !e.url.includes('//www.')
    );

    if (problematicEndpoints.length > 0) {
      console.log('\n⚠️  Found webhook(s) using non-www URL that causes redirects!');
      console.log('These need to be updated to use www.ticketlessamerica.com\n');

      for (const endpoint of problematicEndpoints) {
        const newUrl = endpoint.url.replace('//ticketlessamerica.com/', '//www.ticketlessamerica.com/');
        console.log(`Would update ${endpoint.id}:`);
        console.log(`  From: ${endpoint.url}`);
        console.log(`  To:   ${newUrl}`);
        console.log(`\nTo fix, run: stripe.webhookEndpoints.update('${endpoint.id}', { url: '${newUrl}' })`);
      }
    } else {
      console.log('\n✅ All webhooks are using correct URLs (www.ticketlessamerica.com)');
    }

    // Check for www webhooks
    const wwwEndpoints = endpoints.data.filter(e =>
      e.url.includes('//www.ticketlessamerica.com/')
    );

    if (wwwEndpoints.length > 0) {
      console.log('\n✅ Correct webhook configuration found:');
      wwwEndpoints.forEach(e => {
        console.log(`   ${e.url} (${e.status})`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

fixWebhookUrl();
