require('dotenv').config({ path: '.env.local' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
  try {
    console.log('Updating Stripe price metadata for Rewardful fixed commissions...\n');

    // Update monthly price to pay $2.40 commission
    console.log('Updating monthly price...');
    const monthlyPrice = await stripe.prices.update('price_1SDC0CIOfpchUFab2M3km1yY', {
      metadata: {
        rewardful_commission_amount: '240' // $2.40 in cents
      }
    });
    console.log('✅ Monthly price updated');
    console.log('   Commission: $2.40 (240 cents)');

    // Update annual price to pay $24 commission
    console.log('\nUpdating annual price...');
    const annualPrice = await stripe.prices.update('price_1SDC0cIOfpchUFabjHgPRlx6', {
      metadata: {
        rewardful_commission_amount: '2400' // $24.00 in cents
      }
    });
    console.log('✅ Annual price updated');
    console.log('   Commission: $24.00 (2400 cents)');

    console.log('\n🎉 Done! Rewardful will now pay fixed commissions:');
    console.log('   - Monthly plan: $2.40 per sale');
    console.log('   - Annual plan: $24.00 per sale');
    console.log('\nOne-time sticker fees will NOT generate commissions.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
})();
