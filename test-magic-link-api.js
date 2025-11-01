const fetch = require('node-fetch');

async function testMagicLink() {
  console.log('🔍 Testing magic link API for countluigivampa+1@gmail.com\n');

  const response = await fetch('https://autopilotamerica.com/api/auth/send-magic-link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'countluigivampa+1@gmail.com'
    })
  });

  const data = await response.json();

  console.log('Response status:', response.status);
  console.log('Response data:', JSON.stringify(data, null, 2));

  if (!response.ok) {
    console.log('\n❌ Magic link request failed');
  } else {
    console.log('\n✅ Magic link request succeeded');
    console.log('Check the email inbox for countluigivampa+1@gmail.com');
  }
}

testMagicLink()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
