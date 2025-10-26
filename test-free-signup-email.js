// Test the free signup API directly to see what's happening
const fetch = require('node-fetch');

async function testFreeSignup() {
  const testEmail = 'testfreeuser' + Date.now() + '@gmail.com';
  const testData = {
    firstName: 'Test',
    lastName: 'User',
    email: testEmail,
    phone: '3125551234',
    licensePlate: 'TEST123',
    address: '1710 S Clinton St',
    zip: '60616',
    vin: '',
    make: '',
    model: '',
    citySticker: ''
  };

  console.log('Testing free signup with:', testEmail);
  console.log('Calling production API...\n');

  try {
    const response = await fetch('https://autopilotamerica.com/api/alerts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });

    const result = await response.json();

    console.log('Response status:', response.status);
    console.log('Response body:', JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✅ API call succeeded');
      console.log('User ID:', result.userId);
      console.log('\n📧 Check email:', testEmail);
      console.log('Subject: "Welcome to Autopilot America - Access Your Account"');
      console.log('\nIf no email arrives in 60 seconds, the problem is in the API code.');
    } else {
      console.log('\n❌ API call failed:', result.error);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
  }
}

testFreeSignup();
