#!/usr/bin/env node

// Fix existing user who signed up via OAuth but lost their form data
require('dotenv').config({ path: '.env.local' });

async function fixExistingUser(email) {
  console.log(`🛠️ Fixing existing user: ${email}`);
  console.log('=====================================');
  
  // Mock form data for the user (you can adjust this based on what they filled out)
  const mockFormData = {
    name: 'Randy Sex Doll Now', // From their Google profile
    email: email,
    licensePlate: 'TEMP123', // They'll need to update this
    vin: null,
    zipCode: '60614', // Common Chicago zip
    vehicleType: 'passenger',
    vehicleYear: 2020,
    cityStickerExpiry: '2025-07-31',
    licensePlateExpiry: '2025-12-31',
    emissionsDate: '2025-06-30',
    streetAddress: '123 Main St, Chicago, IL 60614', // They'll need to update
    phone: null, // They'll need to add
    emailNotifications: true,
    smsNotifications: false,
    voiceNotifications: false,
    reminderDays: [30, 7, 1],
    mailingAddress: '123 Main St',
    mailingCity: 'Chicago',
    mailingState: 'IL',
    mailingZip: '60614'
  };
  
  console.log('🔍 Calling save-user-profile API...');
  
  try {
    const response = await fetch('http://localhost:3000/api/save-user-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: '13b33c6f-1ce8-48ff-938c-08803ec48b7e', // hellosexdollnow@gmail.com user ID
        formData: mockFormData
      })
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log('✅ Successfully fixed user profile!');
      console.log('Vehicle ID:', result.vehicle.id);
      console.log('Obligations created:', result.obligations);
    } else {
      console.error('❌ Failed to fix user:', result.error);
      if (result.details) {
        console.error('Details:', JSON.stringify(result.details, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
  
  console.log('\n📝 Note: User should update their profile with correct:');
  console.log('- License plate number');
  console.log('- Actual address');
  console.log('- Phone number');
  console.log('- Renewal dates');
}

// Check if dev server is running first
async function checkDevServer() {
  try {
    const response = await fetch('http://localhost:3000/api/save-user-profile', {
      method: 'GET'
    });
    return response.status === 405; // Should return Method Not Allowed for GET
  } catch (error) {
    return false;
  }
}

async function main() {
  const email = process.argv[2] || 'hellosexdollnow@gmail.com';
  
  console.log('🚀 Starting development server check...');
  const serverRunning = await checkDevServer();
  
  if (!serverRunning) {
    console.error('❌ Development server not running!');
    console.log('Please run: npm run dev');
    return;
  }
  
  await fixExistingUser(email);
}

main().catch(console.error);