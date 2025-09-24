#!/usr/bin/env node

// Test webhook manually
require('dotenv').config({ path: '.env.local' });

const testWebhookData = {
  email: 'test@example.com',
  licensePlate: 'TEST123',
  billingPlan: 'monthly',
  formData: {
    name: 'Test User',
    licensePlate: 'TEST123',
    vin: '1HGCM82633A123456',
    zipCode: '60614',
    vehicleType: 'passenger',
    vehicleYear: 2024,
    cityStickerExpiry: '2025-07-31',
    licensePlateExpiry: '2025-12-31',
    emissionsDate: '2025-06-30',
    streetAddress: '123 Test St, Chicago, IL',
    email: 'test@example.com',
    phone: '312-555-0123',
    emailNotifications: true,
    smsNotifications: true,
    voiceNotifications: false,
    reminderDays: [30, 7, 1],
    mailingAddress: '123 Test St',
    mailingCity: 'Chicago',
    mailingState: 'IL',
    mailingZip: '60614',
    conciergeService: true,
    cityStickersOnly: false,
    spendingLimit: 500
  }
};

async function testCreateCheckout() {
  console.log('Testing create-checkout endpoint...\n');
  
  const response = await fetch('http://localhost:3000/api/create-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(testWebhookData)
  });
  
  const result = await response.json();
  
  if (result.error) {
    console.error('❌ Error:', result.error);
  } else {
    console.log('✅ Checkout session created!');
    console.log('Session ID:', result.sessionId);
    console.log('URL:', result.url);
  }
  
  return result;
}

async function main() {
  try {
    await testCreateCheckout();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();