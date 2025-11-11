/**
 * Test utility bill forwarding webhook
 *
 * This simulates what Resend sends when an email arrives
 */

require('dotenv').config({ path: '.env.local' });

async function testWebhook() {
  // Replace with a real test user UUID from your database
  const TEST_USER_ID = 'REPLACE_WITH_REAL_USER_UUID';

  console.log('🧪 Testing utility bill webhook...\n');

  // This is what Resend sends to your webhook
  const payload = {
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      from: 'noreply@coned.com',
      to: [`documents+${TEST_USER_ID}@autopilotamerica.com`],
      subject: 'Your ComEd Bill for December 2024',
      html: '<p>Your bill is attached.</p>',
      text: 'Your bill is attached.',
      attachments: [
        {
          id: 'test-attachment-id',
          filename: 'comed-bill-dec-2024.pdf',
          content_type: 'application/pdf',
          size: 245678,
          download_url: 'https://example.com/fake-pdf-url.pdf'
        }
      ]
    }
  };

  console.log('📨 Sending test webhook payload:');
  console.log(`  - To: documents+${TEST_USER_ID}@autopilotamerica.com`);
  console.log(`  - From: ${payload.data.from}`);
  console.log(`  - Subject: ${payload.data.subject}`);
  console.log(`  - Attachments: ${payload.data.attachments.length}\n`);

  const response = await fetch('http://localhost:3000/api/email/process-residency-proof-resend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  console.log('📊 Response:');
  console.log(`  - Status: ${response.status}`);
  console.log(`  - Result:`, result);

  if (response.ok) {
    console.log('\n✅ Webhook test successful!');
  } else {
    console.log('\n❌ Webhook test failed!');
  }
}

testWebhook().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
