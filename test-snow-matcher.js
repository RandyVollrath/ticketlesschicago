const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function extractStreetName(address) {
  if (!address) return null;

  const cleaned = address
    .trim()
    .toUpperCase()
    .replace(/,.*$/, '')
    .replace(/#.*$/, '')
    .replace(/APT.*$/i, '')
    .replace(/UNIT.*$/i, '')
    .trim();

  const match = cleaned.match(/^\d+\s+(.+)$/);
  return match && match[1] ? match[1].trim() : null;
}

async function isAddressOnSnowRoute(address) {
  const streetName = extractStreetName(address);

  if (!streetName) {
    return { isOnSnowRoute: false, route: null, streetName: null };
  }

  const { data: routes, error } = await supabase
    .from('snow_routes')
    .select('id, on_street, from_street, to_street, restrict_type')
    .eq('on_street', streetName)
    .limit(1);

  if (error) {
    console.error('Error:', error);
    throw error;
  }

  if (routes && routes.length > 0) {
    return { isOnSnowRoute: true, route: routes[0], streetName };
  }

  // Fuzzy matching
  const fuzzyStreetName = streetName
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD');

  if (fuzzyStreetName !== streetName) {
    const { data: fuzzyRoutes } = await supabase
      .from('snow_routes')
      .select('id, on_street, from_street, to_street, restrict_type')
      .eq('on_street', fuzzyStreetName)
      .limit(1);

    if (fuzzyRoutes && fuzzyRoutes.length > 0) {
      return { isOnSnowRoute: true, route: fuzzyRoutes[0], streetName };
    }
  }

  return { isOnSnowRoute: false, route: null, streetName };
}

async function getUsersOnSnowRoutes() {
  const { data: users } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone_number, first_name, home_address_full')
    .not('home_address_full', 'is', null);

  const usersOnRoutes = [];
  for (const user of users || []) {
    const matchResult = await isAddressOnSnowRoute(user.home_address_full);
    if (matchResult.isOnSnowRoute && matchResult.route) {
      usersOnRoutes.push({ ...user, route: matchResult.route });
    }
  }
  return usersOnRoutes;
}

async function test() {
  console.log('🧪 Testing address matching...\n');

  // Test 1: Known snow route
  const test1 = await isAddressOnSnowRoute('1234 W 111TH ST');
  console.log('Test 1 - "1234 W 111TH ST":');
  console.log('  ✓ On snow route:', test1.isOnSnowRoute);
  console.log('  ✓ Extracted street:', test1.streetName);
  if (test1.route) {
    console.log('  ✓ Route:', test1.route.on_street, '(' + test1.route.from_street, '→', test1.route.to_street + ')');
  }

  // Test 2: Another known route
  const test2 = await isAddressOnSnowRoute('5000 S ASHLAND AVE');
  console.log('\nTest 2 - "5000 S ASHLAND AVE":');
  console.log('  ✓ On snow route:', test2.isOnSnowRoute);
  console.log('  ✓ Extracted street:', test2.streetName);
  if (test2.route) {
    console.log('  ✓ Route:', test2.route.on_street);
  }

  // Test 3: Not on snow route
  const test3 = await isAddressOnSnowRoute('2434 N Southport Ave');
  console.log('\nTest 3 - "2434 N Southport Ave":');
  console.log('  ✓ On snow route:', test3.isOnSnowRoute);
  console.log('  ✓ Extracted street:', test3.streetName);

  // Test 4: Get all users
  console.log('\n📊 Finding all users on snow routes...');
  const usersOnRoutes = await getUsersOnSnowRoutes();
  console.log('  ✓ Found', usersOnRoutes.length, 'users on snow ban routes');

  if (usersOnRoutes.length > 0) {
    console.log('\n  Examples:');
    usersOnRoutes.slice(0, 5).forEach(u => {
      console.log('    •', u.first_name + ':', u.home_address_full);
      console.log('      Route:', u.route.on_street, '(' + u.route.from_street, '→', u.route.to_street + ')');
    });
  }

  console.log('\n✅ Address matching tests complete!');
}

test().catch(console.error);
