const fetch = require('node-fetch');

async function test() {
  const response = await fetch('https://www.autopilotamerica.com/api/alerts/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Debug',
      lastName: 'Test',
      email: 'debugtest12345@gmail.com',
      phone: '5555551234',
      licensePlate: 'DEBUG1',
      address: '123 Debug St',
      zip: '60601'
    })
  });

  const result = await response.json();
  console.log('Response status:', response.status);
  console.log('Response body:', JSON.stringify(result, null, 2));
  console.log('\nloginLink present?', !!result.loginLink);
  console.log('loginLink value:', result.loginLink);
}

test().catch(console.error);
