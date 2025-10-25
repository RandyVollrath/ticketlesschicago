const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Import the address matching logic
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
  if (!streetName) return { isOnRoute: false, route: null };

  const { data: routes } = await supabase
    .from('snow_routes')
    .select('on_street, from_street, to_street')
    .eq('on_street', streetName)
    .limit(1);

  if (routes && routes.length > 0) {
    return { isOnRoute: true, route: routes[0] };
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
      .select('on_street, from_street, to_street')
      .eq('on_street', fuzzyStreetName)
      .limit(1);

    if (fuzzyRoutes && fuzzyRoutes.length > 0) {
      return { isOnRoute: true, route: fuzzyRoutes[0] };
    }
  }

  return { isOnRoute: false, route: null };
}

async function updateAllUsers() {
  console.log('🔄 Updating snow route status for all users...\n');

  // Get all users with street cleaning addresses
  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, home_address_full')
    .not('home_address_full', 'is', null);

  if (error) {
    console.error('Error fetching users:', error);
    process.exit(1);
  }

  console.log(`Found ${users.length} users with addresses\n`);

  let onRouteCount = 0;
  let offRouteCount = 0;
  let autoEnabledCount = 0;

  for (const user of users) {
    const result = await isAddressOnSnowRoute(user.home_address_full);

    if (result.isOnRoute) {
      // Update user profile: mark as on snow route and auto-enable confirmation alerts
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          on_snow_route: true,
          snow_route_street: result.route.on_street,
          notify_snow_confirmation: true, // Auto-enable confirmation alerts
          notify_snow_confirmation_email: true,
          notify_snow_confirmation_sms: true
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error(`Error updating ${user.email}:`, updateError);
      } else {
        console.log(`✓ ${user.email}: ON ROUTE (${result.route.on_street}) - auto-enabled confirmation alerts`);
        onRouteCount++;
        autoEnabledCount++;
      }
    } else {
      // Update user profile: mark as NOT on snow route
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          on_snow_route: false,
          snow_route_street: null
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error(`Error updating ${user.email}:`, updateError);
      } else {
        offRouteCount++;
      }
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total users processed: ${users.length}`);
  console.log(`On snow routes: ${onRouteCount}`);
  console.log(`Not on snow routes: ${offRouteCount}`);
  console.log(`Auto-enabled confirmation alerts: ${autoEnabledCount}`);
  console.log('='.repeat(60));
  console.log('\n✅ Update complete!');
}

updateAllUsers().catch(error => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
