// Test ComEd connection - creates an authorization form for your personal account
require('dotenv').config({ path: '.env.local' });

const TEST_USER_ID = 'test-randy-comed'; // Temporary test user ID
const TEST_EMAIL = 'hiautopilotamerica@gmail.com'; // Your email

async function createComEdForm() {
  console.log('🧪 Creating ComEd authorization form for testing...\n');

  try {
    const response = await fetch('http://localhost:3000/api/utilityapi/create-form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        email: TEST_EMAIL,
        utility: 'ComEd', // Hint that we want ComEd
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Failed to create form:', error);
      process.exit(1);
    }

    const result = await response.json();

    console.log('✅ Authorization form created!\n');
    console.log('📋 Form Details:');
    console.log(`   Form UID: ${result.formUid}`);
    console.log(`   User ID (referral): ${TEST_USER_ID}\n`);

    console.log('🔗 Authorization URL:');
    console.log(`   ${result.formUrl}\n`);

    console.log('📝 Next steps:');
    console.log('   1. Visit the URL above');
    console.log('   2. Select "Commonwealth Edison" (ComEd)');
    console.log('   3. Enter your ComEd account credentials');
    console.log('   4. Authorize access to your bills');
    console.log('   5. You\'ll be redirected back to /settings\n');

    console.log('⏳ After authorization completes, run:');
    console.log(`   curl -X POST http://localhost:3000/api/utilityapi/fetch-bill -H "Content-Type: application/json" -d '{"userId":"${TEST_USER_ID}"}'`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createComEdForm();
