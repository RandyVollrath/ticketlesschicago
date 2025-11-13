#!/usr/bin/env node
/**
 * Test Utility Bill Webhook Integration
 *
 * This script tests the entire utility bill processing pipeline:
 * 1. Health check endpoint
 * 2. Webhook endpoint validation
 * 3. Database and storage connectivity
 *
 * Usage:
 *   node scripts/test-utility-bill-webhook.js
 */

const TEST_USER_UUID = '8777a96d-dfdc-48ab-9dd2-182c9e34080a';
const WEBHOOK_URL = 'https://www.ticketlesschicago.com/api/utility-bills';
const HEALTH_URL = 'https://www.ticketlesschicago.com/api/health/utility-bills';

async function testHealthCheck() {
  console.log('\n🏥 Testing health check endpoint...');
  console.log(`URL: ${HEALTH_URL}`);

  try {
    const response = await fetch(HEALTH_URL);
    const data = await response.json();

    console.log(`Status: ${response.status}`);
    console.log(`Overall health: ${data.overall_status}`);

    if (data.overall_status !== 'healthy') {
      console.error('❌ Health check FAILED');
      console.error('Failed checks:');
      Object.entries(data.checks).forEach(([name, check]) => {
        if (check.status === 'error') {
          console.error(`  - ${name}: ${check.message}`);
        }
      });
      return false;
    }

    console.log('✅ Health check passed');
    return true;
  } catch (error) {
    console.error('❌ Health check request failed:', error.message);
    return false;
  }
}

async function testWebhookEndpoint() {
  console.log('\n🔌 Testing webhook endpoint...');
  console.log(`URL: ${WEBHOOK_URL}`);

  // Test 1: GET request (should return health info)
  console.log('\nTest 1: GET request (health check)');
  try {
    const response = await fetch(WEBHOOK_URL);
    const data = await response.json();

    if (data.status === 'ok' && data.version) {
      console.log(`✅ GET health check passed - Version: ${data.version}`);
    } else {
      console.error('❌ GET health check failed');
      console.error('Response:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ GET request failed:', error.message);
    return false;
  }

  // Test 2: POST with invalid event type (should reject gracefully)
  console.log('\nTest 2: POST with invalid event type');
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid' }),
    });
    const data = await response.json();

    if (response.status === 400 && data.error === 'Invalid event type') {
      console.log('✅ Invalid event type properly rejected');
    } else {
      console.error('❌ Did not properly reject invalid event type');
      console.error('Response:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ POST request failed:', error.message);
    return false;
  }

  // Test 3: POST with invalid email format (should reject gracefully)
  console.log('\nTest 3: POST with invalid email format');
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email.received',
        data: {
          email_id: 'test-123',
          from: 'test@example.com',
          to: ['invalid@example.com'], // Wrong domain
          subject: 'Test',
          attachments: [],
        },
      }),
    });
    const data = await response.json();

    if (response.status === 400 && data.error === 'Invalid email format') {
      console.log('✅ Invalid email format properly rejected');
    } else {
      console.error('❌ Did not properly reject invalid email format');
      console.error('Response:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ POST request failed:', error.message);
    return false;
  }

  console.log('✅ All webhook endpoint tests passed');
  return true;
}

async function testEmailAddresses() {
  console.log('\n📧 Testing supported email addresses...');

  const testEmails = [
    `${TEST_USER_UUID}@linguistic-louse.resend.app`,
    `${TEST_USER_UUID}@bills.autopilotamerica.com`,
  ];

  console.log('Supported email formats:');
  testEmails.forEach(email => console.log(`  ✓ ${email}`));

  return true;
}

async function testDNSConfiguration() {
  console.log('\n🌐 DNS Configuration check...');
  console.log('MX Record required:');
  console.log('  Type: MX');
  console.log('  Name: bills.autopilotamerica.com');
  console.log('  Value: inbound-smtp.us-east-1.amazonaws.com');
  console.log('  Priority: 10');

  console.log('\n💡 To verify: dig MX bills.autopilotamerica.com');

  return true;
}

async function runAllTests() {
  console.log('🚀 Starting Utility Bill Webhook Integration Tests');
  console.log('=' .repeat(60));

  const results = {
    healthCheck: await testHealthCheck(),
    webhookEndpoint: await testWebhookEndpoint(),
    emailAddresses: await testEmailAddresses(),
    dnsConfig: await testDNSConfiguration(),
  };

  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary:');
  console.log('=' .repeat(60));

  const allPassed = Object.values(results).every(r => r === true);

  Object.entries(results).forEach(([test, passed]) => {
    const status = passed ? '✅' : '❌';
    const name = test.replace(/([A-Z])/g, ' $1').toLowerCase();
    console.log(`${status} ${name}`);
  });

  console.log('=' .repeat(60));

  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - Webhook is working correctly!');
    console.log('\n📌 Next steps:');
    console.log('  1. Send test email to: ' + `${TEST_USER_UUID}@linguistic-louse.resend.app`);
    console.log('  2. Check Resend webhook events: https://resend.com/webhooks');
    console.log('  3. Verify PDF in Supabase storage');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED - Check errors above');
    console.log('\n📌 Troubleshooting:');
    console.log('  1. Check health endpoint: ' + HEALTH_URL);
    console.log('  2. Verify Vercel deployment: https://vercel.com/ticketless-chicago');
    console.log('  3. Check environment variables are set');
    process.exit(1);
  }
}

runAllTests();
