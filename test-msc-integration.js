#!/usr/bin/env node

/**
 * Test script for MyStreetCleaning.com integration
 * 
 * Usage:
 * node test-msc-integration.js
 * 
 * This script tests the integration by making a sample API call
 */

const https = require('https');

const testData = {
  email: 'test-integration@ticketlessamerica.com',
  streetAddress: '123 N State St, Chicago, IL 60601',
  userId: 'test-user-123'
};

const postData = JSON.stringify(testData);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/mystreetcleaning-sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('🧪 Testing MyStreetCleaning.com integration...');
console.log('📧 Email:', testData.email);
console.log('🏠 Address:', testData.streetAddress);
console.log('👤 User ID:', testData.userId);
console.log('---');

const req = https.request(options, (res) => {
  console.log('📡 Response status:', res.statusCode);
  console.log('📄 Response headers:', res.headers);
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('📋 Response body:', JSON.stringify(response, null, 2));
      
      if (response.success) {
        console.log('✅ Integration test PASSED');
        console.log('🆔 MyStreetCleaning Account ID:', response.accountId);
      } else {
        console.log('❌ Integration test FAILED');
        console.log('💥 Error:', response.error);
      }
    } catch (parseError) {
      console.log('❌ Failed to parse response as JSON');
      console.log('📄 Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
  
  if (e.code === 'ECONNREFUSED') {
    console.log('💡 Make sure your Next.js dev server is running on localhost:3000');
    console.log('💡 Run: npm run dev');
  }
});

req.write(postData);
req.end();

console.log('⏳ Sending test request...');