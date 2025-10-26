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

function normalizeStreetName(name) {
  return name
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bPLAZA\b/g, 'PLZ')
    .trim();
}

async function isAddressOnWinterBan(address) {
  const streetName = extractStreetName(address);
  if (!streetName) return { isOnWinterBan: false, street: null };

  const { data: streets, error } = await supabase
    .from('winter_overnight_parking_ban_streets')
    .select('id, street_name, from_location, to_location');

  if (error || !streets || streets.length === 0) {
    return { isOnWinterBan: false, street: null };
  }

  const normalizedAddress = normalizeStreetName(streetName);

  for (const street of streets) {
    const normalizedBanStreet = normalizeStreetName(street.street_name);

    if (normalizedAddress.includes(normalizedBanStreet) ||
        normalizedBanStreet.includes(normalizedAddress)) {
      return { isOnWinterBan: true, street: street };
    }
  }

  return { isOnWinterBan: false, street: null };
}

async function updateAllUsers() {
  console.log('🔄 Updating winter ban status for all users...\n');

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

  let onWinterBanCount = 0;
  let notOnWinterBanCount = 0;

  for (const user of users) {
    const result = await isAddressOnWinterBan(user.home_address_full);

    if (result.isOnWinterBan) {
      // Update user profile: mark as on winter ban street
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          on_winter_ban_street: true,
          winter_ban_street: result.street.street_name
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error(`Error updating ${user.email}:`, updateError);
      } else {
        console.log(`✓ ${user.email}: ON WINTER BAN STREET (${result.street.street_name})`);
        onWinterBanCount++;
      }
    } else {
      // Update user profile: mark as NOT on winter ban street
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          on_winter_ban_street: false,
          winter_ban_street: null
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error(`Error updating ${user.email}:`, updateError);
      } else {
        notOnWinterBanCount++;
      }
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total users processed: ${users.length}`);
  console.log(`On winter ban streets: ${onWinterBanCount}`);
  console.log(`Not on winter ban streets: ${notOnWinterBanCount}`);
  console.log('='.repeat(60));
  console.log('\n✅ Update complete!');
}

updateAllUsers().catch(error => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
