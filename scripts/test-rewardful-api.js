#!/usr/bin/env node

// Test Rewardful REST API integration
require('dotenv').config({ path: '.env.local' });

async function testRewardfulAPI() {
  console.log('🧪 TESTING REWARDFUL REST API');
  console.log('=============================\n');
  
  const API_SECRET = process.env.REWARDFUL_API_SECRET;
  
  if (!API_SECRET) {
    console.error('❌ REWARDFUL_API_SECRET not found in .env.local');
    return;
  }
  
  console.log('✅ API Secret found:', API_SECRET.substring(0, 10) + '...\n');
  
  // Create Basic Auth string (API Secret as username, no password)
  const authString = Buffer.from(`${API_SECRET}:`).toString('base64');
  
  try {
    // Test 1: Get affiliates to verify API connection
    console.log('📋 Test 1: Checking API connection...');
    const affiliatesResponse = await fetch('https://api.getrewardful.com/v1/affiliates', {
      headers: {
        'Authorization': `Basic ${authString}`
      }
    });
    
    if (affiliatesResponse.ok) {
      console.log('✅ API connection successful!');
      const data = await affiliatesResponse.json();
      console.log(`   Found ${data.pagination?.total_count || 0} affiliates\n`);
    } else {
      console.log('❌ API connection failed:', affiliatesResponse.status, affiliatesResponse.statusText);
      const error = await affiliatesResponse.text();
      console.log('   Error:', error);
      return;
    }
    
    // Test 2: Get referrals to see the structure
    console.log('📋 Test 2: Checking referrals structure...');
    const referralsResponse = await fetch('https://api.getrewardful.com/v1/referrals?limit=1', {
      headers: {
        'Authorization': `Basic ${authString}`
      }
    });
    
    if (referralsResponse.ok) {
      const data = await referralsResponse.json();
      if (data.data && data.data.length > 0) {
        console.log('✅ Sample referral structure:');
        console.log(JSON.stringify(data.data[0], null, 2));
      } else {
        console.log('ℹ️  No referrals found yet');
      }
    }
    
    console.log('\n📊 CONVERSION TRACKING REQUIREMENTS:');
    console.log('1. Referral ID (UUID) from Rewardful.referral');
    console.log('2. Customer email address');
    console.log('3. Amount in cents');
    console.log('4. Currency code (USD)');
    console.log('5. External ID (Stripe session ID)');
    
    console.log('\n🔧 WEBHOOK CONVERSION FORMAT:');
    console.log(`{
  "referral": "UUID-from-cookie",
  "external_id": "stripe_session_id",
  "email": "customer@example.com",
  "amount": 1200,
  "currency": "USD"
}`);
    
    console.log('\n✅ API configuration is correct!');
    console.log('   Endpoint: https://api.getrewardful.com/v1/');
    console.log('   Auth: Basic Auth with API Secret as username');
    
  } catch (error) {
    console.error('❌ Error testing API:', error.message);
  }
}

testRewardfulAPI().catch(console.error);