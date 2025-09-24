#!/usr/bin/env node

// Manually test webhook data saving for existing user
require('dotenv').config({ path: '.env.local' });

async function testWebhookForUser(email) {
  console.log(`🧪 Testing webhook data save for: ${email}`);
  console.log('===============================================');
  
  // Mock Stripe checkout session data
  const mockFormData = {
    name: 'Chicago Entrepreneur',
    email: email,
    licensePlate: 'ENTRE01',
    vin: '1HGCM82633A001122',
    zipCode: '60601',
    vehicleType: 'passenger',
    vehicleYear: 2022,
    cityStickerExpiry: '2025-07-31',
    licensePlateExpiry: '2025-12-31',
    emissionsDate: '2025-06-30',
    streetAddress: '100 N Riverside Plaza, Chicago, IL 60606',
    phone: '312-555-0100',
    emailNotifications: true,
    smsNotifications: true,
    voiceNotifications: false,
    reminderDays: [30, 7, 1],
    mailingAddress: '100 N Riverside Plaza',
    mailingCity: 'Chicago',
    mailingState: 'IL',
    mailingZip: '60606',
    billingPlan: 'monthly',
    conciergeService: true,
    cityStickersOnly: false,
    spendingLimit: 500
  };

  console.log('📋 Mock form data created');
  console.log('🔍 Looking up user ID...');
  
  try {
    // Get user ID
    const response = await fetch('http://localhost:3000/api/save-user-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: '612e7eec-008d-4ee6-a176-e2627a2dbf9e', // chicagoentrepretour@gmail.com
        formData: mockFormData
      })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log('✅ SUCCESS! Webhook simulation worked');
      console.log('Vehicle created:', result.vehicle.license_plate);
      console.log('Obligations created:', result.obligations);
      console.log('\n🎯 The issue is likely:');
      console.log('- User signed up but did not complete Stripe payment');
      console.log('- Or webhook was not triggered by Stripe');
      console.log('- Webhook code works fine when called directly');
    } else {
      console.log('❌ FAILED! Webhook simulation failed');
      console.log('Error:', result.error);
      if (result.details) {
        console.log('Details:', JSON.stringify(result.details, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Network/Server Error:', error.message);
    console.log('\n💡 Make sure dev server is running: npm run dev');
  }
}

async function main() {
  const email = 'chicagoentrepretour@gmail.com';
  
  console.log('🚀 Starting dev server check...');
  
  try {
    const response = await fetch('http://localhost:3000/api/save-user-profile', {
      method: 'GET'
    });
    
    if (response.status === 405) {
      console.log('✅ Dev server is running');
      await testWebhookForUser(email);
    } else {
      console.log('❌ Dev server not responding correctly');
    }
  } catch (error) {
    console.log('❌ Dev server not running');
    console.log('Please run: npm run dev');
  }
}

main().catch(console.error);