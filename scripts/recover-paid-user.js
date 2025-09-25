#!/usr/bin/env node

// Recover data for user who paid but webhook didn't save data
require('dotenv').config({ path: '.env.local' });

async function recoverPaidUser(email, paymentAmount = 12.00) {
  console.log(`🛠️  RECOVERING PAID USER: ${email}`);
  console.log('=====================================');
  console.log(`💰 Payment amount: $${paymentAmount}`);
  console.log('⏰ Payment time: Sep 24, 5:01 PM');
  console.log('✅ Payment status: Succeeded\n');

  // Since we don't have the original form data, create reasonable defaults
  // The user can update these in their profile settings
  const recoveryFormData = {
    name: 'Chicago Entrepreneur', // They can update this
    email: email,
    licensePlate: 'UPDATE01', // They MUST update this
    vin: null, // Optional
    zipCode: '60601', // Chicago default
    vehicleType: 'passenger',
    vehicleYear: 2020,
    cityStickerExpiry: '2025-07-31',
    licensePlateExpiry: '2025-12-31', 
    emissionsDate: '2025-06-30',
    streetAddress: 'Chicago, IL', // They should update with real address
    phone: null, // They can add this
    emailNotifications: true,
    smsNotifications: false,
    voiceNotifications: false,
    reminderDays: [30, 7, 1],
    mailingAddress: 'Chicago',
    mailingCity: 'Chicago', 
    mailingState: 'IL',
    mailingZip: '60601',
    billingPlan: paymentAmount >= 120 ? 'annual' : 'monthly',
    conciergeService: true,
    cityStickersOnly: false,
    spendingLimit: 500
  };

  console.log('📋 Recovery form data prepared');
  console.log('🔍 User ID: 612e7eec-008d-4ee6-a176-e2627a2dbf9e');

  try {
    console.log('🚀 Calling save-user-profile API...');
    
    const response = await fetch('http://localhost:3001/api/save-user-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: '612e7eec-008d-4ee6-a176-e2627a2dbf9e',
        formData: recoveryFormData
      })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log('\n✅ SUCCESS! User data recovered:');
      console.log('   Vehicle ID:', result.vehicle.id);
      console.log('   License Plate:', result.vehicle.license_plate);
      console.log('   Obligations:', result.obligations);
      
      console.log('\n📝 IMPORTANT: Tell the user to update:');
      console.log('   ❗ License plate number (currently set to "UPDATE01")');
      console.log('   ❗ Actual street address');
      console.log('   ❗ Phone number (if they want SMS notifications)');
      console.log('   ❗ Vehicle year and other details');
      
      console.log('\n🎯 User should now see their data in profile settings!');
      
    } else {
      console.log('\n❌ RECOVERY FAILED:');
      console.log('   Error:', result.error);
      if (result.details) {
        console.log('   Details:', JSON.stringify(result.details, null, 2));
      }
    }

  } catch (error) {
    console.error('\n❌ Network Error:', error.message);
    console.log('   Make sure dev server is running: npm run dev');
  }
}

async function checkDevServer() {
  try {
    const response = await fetch('http://localhost:3001/api/save-user-profile', {
      method: 'GET'
    });
    return response.status === 405;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔧 Checking dev server...');
  
  if (await checkDevServer()) {
    console.log('✅ Dev server running\n');
    await recoverPaidUser('chicagoentrepretour@gmail.com', 12.00);
  } else {
    console.log('❌ Dev server not running!');
    console.log('Please run: npm run dev');
  }
}

main().catch(console.error);