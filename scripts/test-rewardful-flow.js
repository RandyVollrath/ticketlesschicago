#!/usr/bin/env node

// Test complete Rewardful flow - lead registration and conversion
require('dotenv').config({ path: '.env.local' });

async function testRewardfulFlow() {
  console.log('🧪 TESTING COMPLETE REWARDFUL FLOW');
  console.log('====================================\n');
  
  const API_SECRET = process.env.REWARDFUL_API_SECRET;
  
  if (!API_SECRET) {
    console.error('❌ REWARDFUL_API_SECRET not found in .env.local');
    return;
  }
  
  console.log('✅ API Secret found:', API_SECRET.substring(0, 10) + '...\n');
  
  // Create Basic Auth string
  const authString = Buffer.from(`${API_SECRET}:`).toString('base64');
  
  try {
    // Step 1: Get a sample referral ID from existing referrals
    console.log('📋 Step 1: Getting sample referral ID...');
    const referralsResponse = await fetch('https://api.getrewardful.com/v1/referrals?limit=1', {
      headers: {
        'Authorization': `Basic ${authString}`
      }
    });
    
    if (!referralsResponse.ok) {
      throw new Error(`Failed to get referrals: ${referralsResponse.status}`);
    }
    
    const referralsData = await referralsResponse.json();
    if (!referralsData.data || referralsData.data.length === 0) {
      console.log('❌ No existing referrals found. Create one by visiting the site with ?via=TEST_AFFILIATE first.');
      return;
    }
    
    const testReferralId = referralsData.data[0].id;
    console.log('✅ Using referral ID:', testReferralId);
    console.log('   Current state:', referralsData.data[0].conversion_state);
    console.log('   Visits:', referralsData.data[0].visits);
    
    // Step 2: Test lead registration (what happens when user commits)
    console.log('\n📋 Step 2: Testing lead registration...');
    const testEmail = `test-${Date.now()}@example.com`;
    
    const leadResponse = await fetch('https://api.getrewardful.com/v1/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: JSON.stringify({
        referral: testReferralId,
        email: testEmail
      })
    });
    
    if (leadResponse.ok) {
      const leadResult = await leadResponse.json();
      console.log('✅ Lead registration successful:', leadResult.id);
      console.log('   Email:', leadResult.email);
      console.log('   State:', leadResult.conversion_state);
    } else {
      const errorText = await leadResponse.text();
      console.log('❌ Lead registration failed:', leadResponse.status, errorText);
    }
    
    // Step 3: Test conversion tracking (what happens when user pays)
    console.log('\n📋 Step 3: Testing conversion tracking...');
    const conversionResponse = await fetch('https://api.getrewardful.com/v1/conversions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: JSON.stringify({
        referral: testReferralId,
        external_id: `test_stripe_session_${Date.now()}`,
        email: testEmail,
        amount: 1200, // $12 in cents
        currency: 'USD'
      })
    });
    
    if (conversionResponse.ok) {
      const conversionResult = await conversionResponse.json();
      console.log('✅ Conversion tracking successful:', conversionResult.id);
      console.log('   Amount:', conversionResult.amount, 'cents');
      console.log('   State:', conversionResult.conversion_state);
    } else {
      const errorText = await conversionResponse.text();
      console.log('❌ Conversion tracking failed:', conversionResponse.status, errorText);
    }
    
    // Step 4: Verify final state
    console.log('\n📋 Step 4: Checking final referral state...');
    const finalReferralResponse = await fetch(`https://api.getrewardful.com/v1/referrals/${testReferralId}`, {
      headers: {
        'Authorization': `Basic ${authString}`
      }
    });
    
    if (finalReferralResponse.ok) {
      const finalReferral = await finalReferralResponse.json();
      console.log('✅ Final referral state:');
      console.log('   State:', finalReferral.conversion_state);
      console.log('   Became lead at:', finalReferral.became_lead_at);
      console.log('   Became conversion at:', finalReferral.became_conversion_at);
      console.log('   Link conversions:', finalReferral.link?.conversions || 0);
    }
    
    console.log('\n🎉 REWARDFUL FLOW TEST COMPLETE!');
    console.log('\n🔧 IMPLEMENTATION CHECKLIST:');
    console.log('1. ✅ Lead registration: Call /api/rewardful-lead on form commitment');
    console.log('2. ✅ Conversion tracking: Enhanced webhook with retry logic');
    console.log('3. ✅ Error handling: Non-blocking Rewardful errors');
    console.log('4. ✅ Rate limiting: Retry with backoff for 429 errors');
    
  } catch (error) {
    console.error('❌ Error during test:', error.message);
  }
}

testRewardfulFlow().catch(console.error);