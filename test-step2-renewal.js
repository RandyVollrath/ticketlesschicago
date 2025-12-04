/**
 * Test Step 2: Automatic Sticker Charge + Stripe Connect Transfer
 *
 * This script simulates the process-all-renewals cron job for testing.
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

// Sticker price IDs for Passenger (P) vehicle type
// Using live price from Stripe
const STICKER_PRICE_ID = process.env.STRIPE_CITY_STICKER_P_PRICE_ID;

// Fees
const STRIPE_PERCENTAGE_FEE = 0.029;
const STRIPE_FIXED_FEE = 0.30;
const SERVICE_FEE = 2.50;
const REMITTER_SERVICE_FEE = 12.00;

const DRY_RUN = process.argv[2] === '--dry-run';

async function getStickerPrice() {
  if (!STICKER_PRICE_ID) {
    throw new Error('STRIPE_CITY_STICKER_P_PRICE_ID not configured');
  }

  const price = await stripe.prices.retrieve(STICKER_PRICE_ID);
  if (!price.unit_amount) {
    throw new Error(`Stripe price ${STICKER_PRICE_ID} has no unit_amount`);
  }
  return price.unit_amount / 100;
}

function calculateTotalWithFees(basePrice) {
  const total = (basePrice + SERVICE_FEE + STRIPE_FIXED_FEE) / (1 - STRIPE_PERCENTAGE_FEE);
  return {
    total: Math.round(total * 100) / 100,
    serviceFee: SERVICE_FEE,
  };
}

async function runTest() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`STEP 2: AUTOMATIC STICKER CHARGE + STRIPE CONNECT`);
  console.log(`${DRY_RUN ? '🧪 DRY RUN MODE - No actual charges' : '💰 LIVE MODE - Real charges will be made!'}`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. Get test user
  const { data: customer, error: customerError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'ticketlessamerica@gmail.com')
    .single();

  if (customerError || !customer) {
    console.error('❌ Test user not found:', customerError);
    return;
  }

  console.log('📧 Customer:', customer.email);
  console.log('🚗 License Plate:', customer.license_plate);
  console.log('🏷️  City Sticker Expiry:', customer.city_sticker_expiry);
  console.log('💳 Stripe Customer:', customer.stripe_customer_id);
  console.log('🛡️  Has Protection:', customer.has_protection);
  console.log('🚙 Vehicle Type:', customer.vehicle_type);

  // 2. Check if within renewal window
  const expiryDate = new Date(customer.city_sticker_expiry);
  const today = new Date();
  const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`\n📅 Days until expiry: ${daysUntilExpiry}`);

  if (daysUntilExpiry > 30) {
    console.log('⏳ Not within renewal window (>30 days). No action needed.');
    return;
  }

  if (daysUntilExpiry < 0) {
    console.log('⚠️  Sticker already expired. Would need manual handling.');
    // For testing, we'll continue anyway
  }

  // 3. Check for existing charge
  const { data: existingCharge } = await supabase
    .from('renewal_charges')
    .select('*')
    .eq('user_id', customer.user_id)
    .eq('charge_type', 'sticker_renewal')
    .eq('renewal_due_date', customer.city_sticker_expiry)
    .eq('status', 'succeeded')
    .single();

  if (existingCharge) {
    console.log('✅ Already processed this renewal. Skipping.');
    return;
  }

  // 4. Get remitter
  const { data: remitter, error: remitterError } = await supabase
    .from('renewal_partners')
    .select('*')
    .eq('status', 'active')
    .not('stripe_connected_account_id', 'is', null)
    .neq('stripe_connected_account_id', 'acct_xxxxxxxxxxxxx')
    .limit(1)
    .single();

  if (remitterError || !remitter) {
    console.error('❌ No active remitter with Stripe Connect:', remitterError);
    return;
  }

  console.log(`\n🤝 Remitter: ${remitter.name}`);
  console.log(`   Email: ${remitter.email}`);
  console.log(`   Stripe Connect: ${remitter.stripe_connected_account_id}`);

  // 5. Get sticker price
  let stickerPrice;
  try {
    stickerPrice = await getStickerPrice();
  } catch (err) {
    console.error('❌ Failed to get sticker price:', err.message);
    console.log('\n📝 Available Stripe Price IDs:');
    console.log('   STRIPE_CITY_STICKER_P_PRICE_ID:', process.env.STRIPE_CITY_STICKER_P_PRICE_ID || 'NOT SET');
    return;
  }

  const { total: totalAmount, serviceFee } = calculateTotalWithFees(stickerPrice);

  console.log(`\n💵 Pricing Breakdown:`);
  console.log(`   Sticker price: $${stickerPrice.toFixed(2)}`);
  console.log(`   Service fee: $${serviceFee.toFixed(2)}`);
  console.log(`   Total to customer: $${totalAmount.toFixed(2)}`);
  console.log(`   Remitter receives: $${(stickerPrice + REMITTER_SERVICE_FEE).toFixed(2)} (sticker + $12 service)`);

  // 6. Get payment method
  const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id);

  if (!stripeCustomer || stripeCustomer.deleted) {
    console.error('❌ Stripe customer not found or deleted');
    return;
  }

  let defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method;

  if (!defaultPaymentMethod) {
    console.log('🔍 No customer default PM, checking subscriptions...');
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.stripe_customer_id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length > 0) {
      defaultPaymentMethod = subscriptions.data[0].default_payment_method;
      console.log(`   Found subscription default PM: ${defaultPaymentMethod}`);
    }
  }

  if (!defaultPaymentMethod) {
    console.error('❌ No payment method found');
    return;
  }

  console.log(`\n💳 Payment method: ${defaultPaymentMethod}`);

  // 7. DRY RUN - stop here
  if (DRY_RUN) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🧪 DRY RUN COMPLETE - No charges made');
    console.log('');
    console.log('Would have:');
    console.log(`  ✓ Charged customer $${totalAmount.toFixed(2)}`);
    console.log(`  ✓ Transferred $${stickerPrice.toFixed(2)} to remitter via Connect`);
    console.log(`  ✓ Transferred $${REMITTER_SERVICE_FEE.toFixed(2)} service fee to remitter`);
    console.log(`  ✓ Created renewal_charges record`);
    console.log(`  ✓ Created renewal_orders record for remitter`);
    console.log(`  ✓ Sent emails to customer and remitter`);
    console.log(`${'='.repeat(60)}\n`);
    return;
  }

  // 8. LIVE RUN - Create payment intent with Stripe Connect
  console.log(`\n🔥 CHARGING CUSTOMER...`);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100),
      currency: 'usd',
      customer: customer.stripe_customer_id,
      payment_method: defaultPaymentMethod,
      off_session: true,
      confirm: true,
      description: `City Sticker Renewal - ${customer.license_plate}`,
      metadata: {
        user_id: customer.user_id,
        license_plate: customer.license_plate,
        renewal_type: 'city_sticker',
        expiry_date: customer.city_sticker_expiry,
        sticker_price: stickerPrice.toString(),
        service_fee: serviceFee.toString(),
        total_charged: totalAmount.toString(),
      },
      transfer_data: {
        destination: remitter.stripe_connected_account_id,
        amount: Math.round(stickerPrice * 100), // Remitter gets sticker price
      },
    });

    console.log(`✅ Payment Intent created: ${paymentIntent.id}`);
    console.log(`   Status: ${paymentIntent.status}`);
    console.log(`   Charge ID: ${paymentIntent.latest_charge}`);

    // 9. Send $12 service fee transfer
    console.log(`\n💸 Transferring $${REMITTER_SERVICE_FEE} service fee to remitter...`);

    const serviceFeeTransfer = await stripe.transfers.create({
      amount: Math.round(REMITTER_SERVICE_FEE * 100),
      currency: 'usd',
      destination: remitter.stripe_connected_account_id,
      description: `Sticker Processing Service Fee - ${customer.license_plate}`,
      metadata: {
        user_id: customer.user_id,
        license_plate: customer.license_plate,
        renewal_type: 'city_sticker',
        payment_intent_id: paymentIntent.id,
      },
    });

    console.log(`✅ Service fee transfer: ${serviceFeeTransfer.id}`);

    // 10. Log to database
    console.log(`\n📝 Creating database records...`);

    const { error: chargeError } = await supabase.from('renewal_charges').insert({
      user_id: customer.user_id,
      charge_type: 'sticker_renewal',
      amount: totalAmount,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: paymentIntent.latest_charge,
      status: 'succeeded',
      remitter_partner_id: remitter.id,
      remitter_received_amount: stickerPrice + REMITTER_SERVICE_FEE,
      platform_fee_amount: serviceFee,
      renewal_type: 'city_sticker',
      renewal_due_date: customer.city_sticker_expiry,
      succeeded_at: new Date().toISOString(),
      customer_notified: true,
      notification_sent_at: new Date().toISOString(),
    });

    if (chargeError) console.error('Warning: Failed to log charge:', chargeError);
    else console.log('✅ renewal_charges record created');

    // 11. Create order for remitter
    const orderNumber = 'AUTO-' + Date.now();
    const { error: orderError } = await supabase.from('renewal_orders').insert({
      order_number: orderNumber,
      partner_id: remitter.id,
      customer_name: `${customer.first_name} ${customer.last_name}`,
      customer_email: customer.email,
      customer_phone: customer.phone,
      license_plate: customer.license_plate,
      license_state: customer.license_state || 'IL',
      street_address: customer.street_address,
      city: customer.mailing_city || 'Chicago',
      state: customer.mailing_state || 'IL',
      zip_code: customer.zip_code,
      sticker_type: customer.vehicle_type || 'P',
      sticker_price: stickerPrice,
      service_fee: REMITTER_SERVICE_FEE,
      total_amount: stickerPrice + REMITTER_SERVICE_FEE,
      payment_status: 'paid',
      status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
    });

    if (orderError) console.error('Warning: Failed to create order:', orderError);
    else console.log(`✅ renewal_orders record created: ${orderNumber}`);

    console.log(`\n${'='.repeat(60)}`);
    console.log('🎉 STEP 2 COMPLETE!');
    console.log('');
    console.log(`Customer charged: $${totalAmount.toFixed(2)}`);
    console.log(`Remitter received: $${(stickerPrice + REMITTER_SERVICE_FEE).toFixed(2)}`);
    console.log(`Order #: ${orderNumber}`);
    console.log(`${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('\n❌ CHARGE FAILED:', error.message);
    if (error.raw) console.error('   Raw error:', error.raw.message);

    // Log failure
    await supabase.from('renewal_charges').insert({
      user_id: customer.user_id,
      charge_type: 'sticker_renewal',
      amount: 0,
      status: 'failed',
      failure_reason: error.message,
      failure_code: error.code || 'unknown',
      renewal_type: 'city_sticker',
      renewal_due_date: customer.city_sticker_expiry,
      failed_at: new Date().toISOString(),
    });
  }
}

runTest().catch(console.error);
