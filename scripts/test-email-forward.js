/**
 * Test script for email forwarding feature
 * Tests the full flow: email → parse → token → signup
 */

const sampleEmail = `Dear RANDY VOLLRATH:

Our records indicate that a Chicago City Vehicle Sticker, purchased for the vehicle listed below, was sent on February 18, 2025. Please allow 10 business days for delivery.

Make: TOYOTA
Model: COROLLA
VIN: 2T1BURHE8EC189320
Plate: CW22016
TO AVOID TICKETS, DISPLAY THE CHICAGO CITY VEHICLE STICKER ON THIS VEHICLE IMMEDIATELY.
Vehicles can be ticketed ($200 per ticket) 15 days after the expiration of the Vehicle Sticker. Tickets can be issued daily until a new unexpired Vehicle Sticker is displayed.

NEVER RECEIVED YOUR VEHICLE STICKER?
If we determine that your Vehicle Sticker may have been lost in the mail, you may be eligible to receive a free replacement. To apply for your replacement, you must complete an affidavit form and bring it to a City Clerk location, along with your photo ID and proof of your current address.

ERRORS IN YOUR VEHICLE INFORMATION?
Please utilize our eForm Link to update or correct any above vehicle information.

This email was sent by Sebis Direct, Inc. on behalf of the Office of the City Clerk - City of Chicago.`;

async function testEmailForward() {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

  console.log('📧 Testing email forward feature...\n');

  // Step 1: Send the email to the forward endpoint
  console.log('Step 1: Sending email to /api/email/forward');
  console.log(`Using BASE_URL: ${BASE_URL}\n`);

  const response = await fetch(`${BASE_URL}/api/email/forward`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: sampleEmail,  // Changed to 'text' to match Resend format
      from: 'randyvollrath@gmail.com',
      subject: 'IN THE MAIL - Chicago City Vehicle Sticker Renewal'
    })
  });

  console.log('Status:', response.status, response.statusText);

  let result;
  try {
    result = await response.json();
    console.log('✅ Response:', result);
  } catch (err) {
    const text = await response.text();
    console.error('❌ Non-JSON response:', text);
    return;
  }

  if (!response.ok) {
    console.error('❌ Email forward failed');
    return;
  }

  console.log('\n📬 Check your email for the signup link!');
  console.log('The email should contain:');
  console.log('- Vehicle: TOYOTA COROLLA');
  console.log('- Plate: CW22016');
  console.log('- VIN: 2T1BURHE8EC189320');
  console.log('- Renewal Date: 2026-02-18');
  console.log('- A signup link with a token parameter');

  console.log('\n✨ To complete the test:');
  console.log('1. Click the link in the email');
  console.log('2. Verify the form is pre-filled');
  console.log('3. Add your address and complete signup');
}

testEmailForward().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});