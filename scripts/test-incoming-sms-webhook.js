// Test script to simulate ClickSend incoming SMS webhook
const testPayload = {
  from: '+13125354254',
  body: 'My new license plate is XYZ789 and I moved to 123 Main St',
  message_id: 'test-message-123',
  to: '+18335623866',
  timestamp: new Date().toISOString()
};

async function testWebhook() {
  console.log('📤 Sending test webhook to local/production endpoint...\n');
  console.log('Payload:', JSON.stringify(testPayload, null, 2));

  const url = process.argv[2] || 'http://localhost:3000/api/webhooks/clicksend-incoming-sms';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });

    console.log('\n✅ Response status:', response.status);
    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testWebhook();
