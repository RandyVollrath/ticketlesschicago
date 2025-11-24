// Test UtilityAPI connection and create a form
require('dotenv').config({ path: '.env.local' });

const UTILITYAPI_TOKEN = process.env.UTILITYAPI_TOKEN;
const UTILITYAPI_BASE_URL = 'https://utilityapi.com/api/v2';

async function testUtilityAPI() {
  console.log('🧪 Testing UtilityAPI connection...\n');

  // Test 1: Create a test form
  console.log('1️⃣  Creating test authorization form...');

  try {
    const response = await fetch(`${UTILITYAPI_BASE_URL}/forms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        redirect_uri: 'https://autopilotamerica.com/settings?utility_connected=true',
        customer_email: 'test@example.com',
        referral: 'test-user-id',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Failed to create form:', response.status, error);
      process.exit(1);
    }

    const formData = await response.json();
    console.log('✅ Form created successfully!');
    console.log(`   Form UID: ${formData.uid}`);
    console.log(`   Form URL: ${formData.url}`);
    console.log('\n📋 You can test by visiting this URL:');
    console.log(`   ${formData.url}\n`);

    // Clean up: delete the test form
    console.log('2️⃣  Cleaning up test form...');
    const deleteResponse = await fetch(`${UTILITYAPI_BASE_URL}/forms/${formData.uid}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
      },
    });

    if (deleteResponse.ok) {
      console.log('✅ Test form deleted\n');
    } else {
      console.log('⚠️  Could not delete test form (not critical)\n');
    }

    console.log('✅ UtilityAPI connection working perfectly!');
    console.log('\nNext step: Visit https://localhost:3000 and try connecting your ComEd account');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testUtilityAPI();
