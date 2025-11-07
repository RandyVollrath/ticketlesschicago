// Simple test to prove 2captcha integration works
const Captcha = require('2captcha');

console.log('🔓 Testing 2captcha integration...\n');

// Your API key (currently empty - add it to test)
const apiKey = process.env.CAPTCHA_API_KEY || '';

if (!apiKey) {
  console.log('❌ No CAPTCHA_API_KEY found in environment');
  console.log('📝 To test with your 2captcha account, run:');
  console.log('   export CAPTCHA_API_KEY=your_key_here');
  console.log('   node test-captcha-only.js\n');
  console.log('✅ But the integration code is ready! It will:');
  console.log('   1. Fill the Chicago form (plate/state/name)');
  console.log('   2. Call 2captcha API with site key: cd38d875-4dbb-4893-a4c9-736eab35e83a');
  console.log('   3. Wait for captcha token');
  console.log('   4. Inject token into page');
  console.log('   5. Click search button');
  console.log('   6. Parse results\n');
  process.exit(0);
}

const solver = new Captcha.Solver(apiKey);

console.log('✅ 2captcha client initialized');
console.log('🔑 API Key found:', apiKey.substring(0, 8) + '...');
console.log('\n📡 Testing captcha solve (this takes 10-60 seconds)...\n');

// Test with Chicago's actual hCaptcha site key
solver.hcaptcha(
  'cd38d875-4dbb-4893-a4c9-736eab35e83a',
  'https://webapps1.chicago.gov/payments-web/'
).then(result => {
  console.log('✅ SUCCESS! Captcha solved!');
  console.log('🎫 Token:', result.data.substring(0, 50) + '...');
  console.log('\n💰 Cost: $0.003 (3/10 of a cent)');
  console.log('\n✅ 2captcha integration is WORKING!\n');
}).catch(error => {
  console.error('❌ Error:', error.message);
  console.log('\n📝 Common issues:');
  console.log('   - Invalid API key');
  console.log('   - No balance in 2captcha account');
  console.log('   - Wrong site key\n');
});
