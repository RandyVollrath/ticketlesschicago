require('dotenv').config({ path: '.env.local' });

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function check() {
  const customerId = process.argv[2] || 'cus_TX69BySckMnper';

  try {
    const customer = await stripe.customers.retrieve(customerId);
    console.log('Customer:', customer.id);
    console.log('Email:', customer.email);
    console.log('Default payment method:', customer.invoice_settings?.default_payment_method || 'NOT SET');

    // List payment methods
    const methods = await stripe.paymentMethods.list({ customer: customer.id, type: 'card' });
    console.log('Payment methods on file:', methods.data.length);
    methods.data.forEach(m => {
      console.log('  -', m.id, m.card.brand, '****' + m.card.last4);
    });

    // Check subscriptions
    const subscriptions = await stripe.subscriptions.list({ customer: customer.id });
    console.log('Subscriptions:', subscriptions.data.length);
    subscriptions.data.forEach(s => {
      console.log('  - Status:', s.status, '| Default PM:', s.default_payment_method || 'NOT SET');
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

check();
