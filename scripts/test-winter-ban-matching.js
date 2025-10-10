// Test script to verify winter ban street matching
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const TEST_ADDRESSES = [
  { address: '123 Madison Ave, Chicago, IL', shouldMatch: true, expectedStreet: 'MADISON AVE' },
  { address: '456 State Street, Chicago, IL 60605', shouldMatch: true, expectedStreet: 'STATE STREET' },
  { address: '789 Clark Street, Chicago, IL', shouldMatch: true, expectedStreet: 'CLARK STREET' },
  { address: '1000 N Ashland Ave, Chicago, IL', shouldMatch: false, expectedStreet: null },
  { address: '2500 Cottage Grove, Chicago, IL', shouldMatch: true, expectedStreet: 'COTTAGE GROVE' },
  { address: '3500 Kedzie Ave, Chicago, IL', shouldMatch: true, expectedStreet: 'KEDZIE AVE.' },
  { address: '100 W Chicago Ave, Chicago, IL', shouldMatch: false, expectedStreet: null },
];

async function testAddressMatching() {
  console.log('🧪 Testing Winter Ban Street Matching\n');
  console.log('='.repeat(60));

  // First, get all winter ban streets
  const { data: banStreets, error } = await supabase
    .from('winter_overnight_parking_ban_streets')
    .select('street_name');

  if (error) {
    console.error('❌ Error fetching ban streets:', error);
    return;
  }

  console.log(`\n✅ Loaded ${banStreets.length} winter ban streets from database\n`);

  const streetNames = banStreets.map(s => s.street_name.toLowerCase());
  let passed = 0;
  let failed = 0;

  for (const test of TEST_ADDRESSES) {
    const addressLower = test.address.toLowerCase();
    const matchedStreet = streetNames.find(street =>
      addressLower.includes(street.toLowerCase())
    );

    const isMatch = !!matchedStreet;
    const testPassed = (isMatch === test.shouldMatch) &&
      (!isMatch || matchedStreet.toLowerCase() === test.expectedStreet?.toLowerCase());

    if (testPassed) {
      passed++;
      console.log(`✅ PASS: "${test.address}"`);
      if (isMatch) {
        console.log(`   Matched: ${matchedStreet.toUpperCase()}`);
      } else {
        console.log(`   No match (as expected)`);
      }
    } else {
      failed++;
      console.log(`❌ FAIL: "${test.address}"`);
      console.log(`   Expected: ${test.shouldMatch ? `Match ${test.expectedStreet}` : 'No match'}`);
      console.log(`   Got: ${isMatch ? `Match ${matchedStreet}` : 'No match'}`);
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${TEST_ADDRESSES.length} tests\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Review the address matching logic.');
  }
}

testAddressMatching()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
