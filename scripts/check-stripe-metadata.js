#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function check() {
  const sessions = await stripe.checkout.sessions.list({ limit: 30 });
  const session = sessions.data.find(s => s.customer_details?.email === 'mystreetcleaning+1@gmail.com');
  
  if (session) {
    console.log('Stripe Session Metadata:');
    console.log(JSON.stringify(session.metadata, null, 2));
    console.log('');
    console.log('Customer Details:');
    console.log('  Name:', session.customer_details?.name || 'NULL');
    console.log('  Zip:', session.customer_details?.address?.postal_code || 'NULL');
  } else {
    console.log('Session not found');
  }
}

check().catch(console.error);
