// Debug script to test Rewardful integration
require('dotenv').config({ path: '.env.local' });

async function testRewardfulIntegration() {
  console.log('🔍 Testing Rewardful Integration...\n');
  
  // 1. Check environment variables
  console.log('1. Environment Variables:');
  console.log(`REWARDFUL_API_SECRET: ${process.env.REWARDFUL_API_SECRET ? '✅ Set' : '❌ Missing'}`);
  
  if (!process.env.REWARDFUL_API_SECRET) {
    console.log('❌ REWARDFUL_API_SECRET is required. Get it from: https://rewardful.com/dashboard/settings/api');
    return;
  }
  
  // 2. Test API connection
  console.log('\n2. Testing Rewardful API Connection:');
  try {
    const response = await fetch('https://api.rewardful.com/referrals', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.REWARDFUL_API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      console.log('✅ API connection successful');
      const data = await response.json();
      console.log(`📊 Found ${data.length || 0} referrals in your account`);
    } else {
      console.log(`❌ API connection failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error) {
    console.log('❌ API connection error:', error.message);
  }
  
  // 3. Test conversion creation (dry run)
  console.log('\n3. Testing Conversion Creation (Dry Run):');
  const testReferralId = 'test-referral-123';
  const testConversionData = {
    referral: testReferralId,
    amount: 1200, // $12.00 in cents
    currency: 'USD',
    external_id: `test-stripe-session-${Date.now()}`,
    email: 'test@example.com'
  };
  
  try {
    console.log('Sending test conversion:', testConversionData);
    const response = await fetch('https://api.rewardful.com/conversions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.REWARDFUL_API_SECRET}`
      },
      body: JSON.stringify(testConversionData)
    });
    
    if (response.ok) {
      console.log('✅ Test conversion would succeed');
    } else if (response.status === 422) {
      console.log('⚠️  Test conversion rejected (likely because test referral doesn\'t exist) - this is normal');
    } else {
      console.log(`❌ Test conversion failed: ${response.status}`);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error) {
    console.log('❌ Test conversion error:', error.message);
  }
  
  console.log('\n📋 Next Steps:');
  console.log('1. Ensure REWARDFUL_API_SECRET is set in production');
  console.log('2. Test a real purchase with ?rwid=YOUR_REFERRAL_ID');
  console.log('3. Check Stripe webhook logs for Rewardful conversion attempts');
  console.log('4. Check Rewardful dashboard for pending conversions');
}

testRewardfulIntegration().catch(console.error);