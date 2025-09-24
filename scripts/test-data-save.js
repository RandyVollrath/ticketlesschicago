#!/usr/bin/env node

// Test saving user data directly
require('dotenv').config({ path: '.env.local' });

const testData = {
  email: 'randyvollrath@gmail.com',
  formData: {
    name: 'Randy Vollrath',
    licensePlate: 'RV2024',
    vin: '1HGCM82633A123456',
    zipCode: '60614',
    vehicleType: 'passenger',
    vehicleYear: 2020,
    cityStickerExpiry: '2025-07-31',
    licensePlateExpiry: '2025-12-31',
    emissionsDate: '2025-06-30',
    streetAddress: '123 Main St, Chicago, IL',
    email: 'randyvollrath@gmail.com',
    phone: '312-555-0123',
    emailNotifications: true,
    smsNotifications: true,
    voiceNotifications: false,
    reminderDays: [30, 7, 1],
    mailingAddress: '123 Main St',
    mailingCity: 'Chicago',
    mailingState: 'IL',
    mailingZip: '60614',
    conciergeService: true,
    cityStickersOnly: false,
    spendingLimit: 500
  }
};

async function testWebhookEndpoint() {
  console.log('Testing webhook data save for:', testData.email);
  console.log('=====================================\n');
  
  try {
    const response = await fetch('http://localhost:3000/api/webhook-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('❌ Error:', result.error);
      if (result.details) {
        console.log('Details:', JSON.stringify(result.details, null, 2));
      }
    }
  } catch (error) {
    console.error('Network error:', error.message);
    console.log('\nMake sure the development server is running: npm run dev');
  }
}

testWebhookEndpoint();