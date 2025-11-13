const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load .env.local instead of .env
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

async function testLicenseUpload() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('🔍 Testing License Upload Requirements\n');
  console.log('Looking for Randy\'s profile...\n');

  // Find Randy's user
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, has_protection, city_sticker_expiry, has_permit_zone, license_image_path, home_address_full')
    .or('email.ilike.%randy%,email.ilike.%vollrath%')
    .limit(5);

  if (error) {
    console.error('❌ Error fetching profiles:', error);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.log('❌ No profiles found matching Randy/Vollrath');
    return;
  }

  console.log(`Found ${profiles.length} profile(s):\n`);

  profiles.forEach((profile, index) => {
    console.log(`Profile ${index + 1}:`);
    console.log(`  Email: ${profile.email}`);
    console.log(`  Address: ${profile.home_address_full || 'Not set'}`);
    console.log(`  Has Protection: ${profile.has_protection ? '✅' : '❌'}`);
    console.log(`  City Sticker Expiry: ${profile.city_sticker_expiry || '❌ Not set'}`);
    console.log(`  Has Permit Zone: ${profile.has_permit_zone ? '✅' : '❌'}`);
    console.log(`  License Image: ${profile.license_image_path || '❌ Not uploaded'}`);

    const canSeeUpload = profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone;
    console.log(`\n  ${canSeeUpload ? '✅ CAN SEE' : '❌ CANNOT SEE'} license upload section`);

    if (!canSeeUpload) {
      console.log('\n  Missing requirements:');
      if (!profile.has_protection) console.log('    - Has Protection (need to enable protection plan)');
      if (!profile.city_sticker_expiry) console.log('    - City Sticker Expiry (need to set expiry date)');
      if (!profile.has_permit_zone) console.log('    - Has Permit Zone (need permit zone flag)');
    }
    console.log('');
  });
}

testLicenseUpload().catch(console.error);
