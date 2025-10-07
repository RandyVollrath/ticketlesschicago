require('dotenv').config({ path: '.env.local' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
  try {
    console.log('Checking Stripe price metadata for Rewardful commissions...\n');

    const monthlyPrice = await stripe.prices.retrieve('price_1SDC0CIOfpchUFab2M3km1yY');
    const annualPrice = await stripe.prices.retrieve('price_1SDC0cIOfpchUFabjHgPRlx6');

    console.log('✅ Monthly Price (price_1SDC0CIOfpchUFab2M3km1yY):');
    console.log('   Amount:', monthlyPrice.unit_amount / 100, 'USD');
    console.log('   Metadata:', JSON.stringify(monthlyPrice.metadata, null, 2));
    console.log('   Expected commission metadata: { rewardful_commission_amount: "240" }');
    console.log('');

    console.log('✅ Annual Price (price_1SDC0cIOfpchUFabjHgPRlx6):');
    console.log('   Amount:', annualPrice.unit_amount / 100, 'USD');
    console.log('   Metadata:', JSON.stringify(annualPrice.metadata, null, 2));
    console.log('   Expected commission metadata: { rewardful_commission_amount: "2400" }');
    console.log('');

    // Check if metadata is correctly set
    const monthlyCorrect = monthlyPrice.metadata?.rewardful_commission_amount === '240';
    const annualCorrect = annualPrice.metadata?.rewardful_commission_amount === '2400';

    if (monthlyCorrect && annualCorrect) {
      console.log('🎉 Perfect! Both prices have the correct Rewardful commission metadata.');
      console.log('   Monthly will pay $2.40 commission');
      console.log('   Annual will pay $24.00 commission');
    } else {
      console.log('⚠️  Metadata needs to be updated:');
      if (!monthlyCorrect) {
        console.log('   - Monthly price needs: rewardful_commission_amount = "240"');
      }
      if (!annualCorrect) {
        console.log('   - Annual price needs: rewardful_commission_amount = "2400"');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
})();
