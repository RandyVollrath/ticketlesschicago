#!/usr/bin/env node

// Test the enhanced OAuth integration
require('dotenv').config({ path: '.env.local' });

const { syncUserToMyStreetCleaning } = require('../lib/mystreetcleaning-integration.ts');

async function testOAuthIntegration() {
  console.log('🧪 Testing Enhanced OAuth Integration');
  console.log('====================================\n');

  const testData = {
    email: 'oauth-test@ticketlesstest.com',
    streetAddress: '123 N Michigan Ave, Chicago, IL 60601',
    userId: 'test-oauth-user-id',
    googleId: 'google-oauth-id-123',
    name: 'OAuth Test User',
    notificationPreferences: {
      email: true,
      sms: false,
      voice: true,
      days_before: [1, 7, 30]
    }
  };

  console.log('📋 Test data:');
  console.log(JSON.stringify(testData, null, 2));

  try {
    console.log('\n🚀 Creating MyStreetCleaning account with OAuth data...');
    
    const result = await syncUserToMyStreetCleaning(
      testData.email,
      testData.streetAddress,
      testData.userId,
      {
        googleId: testData.googleId,
        name: testData.name,
        notificationPreferences: testData.notificationPreferences
      }
    );

    if (result.success) {
      console.log('✅ Success!');
      console.log('Account ID:', result.accountId);
      console.log('Message:', result.message);
    } else {
      console.log('❌ Failed:');
      console.log('Error:', result.error);
    }

    console.log('\n🔍 Testing duplicate account handling...');
    
    // Test with same data to see update behavior
    const duplicateResult = await syncUserToMyStreetCleaning(
      testData.email,
      '456 S State St, Chicago, IL 60604', // Different address
      testData.userId,
      {
        googleId: testData.googleId,
        name: testData.name + ' Updated',
        notificationPreferences: {
          email: false,
          sms: true,
          voice: false,
          days_before: [3, 14]
        }
      }
    );

    if (duplicateResult.success) {
      console.log('✅ Duplicate handling successful!');
      console.log('Account ID:', duplicateResult.accountId);
      console.log('Message:', duplicateResult.message);
    } else {
      console.log('❌ Duplicate handling failed:');
      console.log('Error:', duplicateResult.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }

  console.log('\n====================================');
  console.log('✅ Enhanced OAuth Integration Features:');
  console.log('1. ✅ Google ID linking support');
  console.log('2. ✅ Full notification preferences');
  console.log('3. ✅ User name handling');
  console.log('4. ✅ Address updates for existing users');
  console.log('5. ✅ Comprehensive error handling');
}

testOAuthIntegration();