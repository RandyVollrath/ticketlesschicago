// Manual test script for Rewardful API
// Usage: REWARDFUL_API_SECRET=your_secret node test-rewardful-manual.js

const REWARDFUL_API_SECRET = process.env.REWARDFUL_API_SECRET;

if (!REWARDFUL_API_SECRET) {
  console.log('❌ Please set REWARDFUL_API_SECRET environment variable');
  console.log('Usage: REWARDFUL_API_SECRET=your_secret node test-rewardful-manual.js');
  process.exit(1);
}

async function testRewardfulAPI() {
  console.log('🔍 Testing Rewardful API...\n');

  try {
    // Test API connectivity
    console.log('1. Testing API connectivity...');
    const testResponse = await fetch('https://api.rewardful.com/referrals', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${REWARDFUL_API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    if (!testResponse.ok) {
      console.log(`❌ API test failed: ${testResponse.status} ${testResponse.statusText}`);
      const errorText = await testResponse.text();
      console.log('Error details:', errorText);
      return;
    }

    console.log('✅ API connectivity successful');
    const referrals = await testResponse.json();
    console.log(`📊 Found ${referrals.length} referrals in your account`);

    if (referrals.length > 0) {
      const testReferral = referrals[0];
      console.log(`🧪 Using referral ID for test: ${testReferral.token}`);

      // Test conversion creation
      console.log('\n2. Testing conversion creation...');
      const conversionData = {
        referral: testReferral.token,
        amount: 1200, // $12.00 in cents
        currency: 'USD',
        external_id: `test-conversion-${Date.now()}`,
        email: 'test@ticketlessamerica.com'
      };

      console.log('Sending conversion data:', conversionData);

      const conversionResponse = await fetch('https://api.rewardful.com/conversions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${REWARDFUL_API_SECRET}`
        },
        body: JSON.stringify(conversionData)
      });

      if (conversionResponse.ok) {
        const conversion = await conversionResponse.json();
        console.log('✅ Test conversion created successfully!');
        console.log('Conversion details:', conversion);
      } else {
        console.log(`❌ Conversion creation failed: ${conversionResponse.status}`);
        const errorText = await conversionResponse.text();
        console.log('Error details:', errorText);
      }
    } else {
      console.log('⚠️ No referrals found. Create a referral first in your Rewardful dashboard.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testRewardfulAPI();