const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixProfile(email, metadata) {
  console.log(`\n🔧 Fixing profile for: ${email}\n`);

  // Get user
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const user = authUsers?.users?.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('✅ Found user:', userId);

  // Update profile with protection data
  const updateData = {
    has_protection: true,
    phone_number: metadata.phone || null,
    mailing_address: metadata.address || null,
    street_address: metadata.address || null,
    home_address_full: metadata.address || null,
    city_sticker_expiry: metadata.citySticker || null,
    license_plate_expiry: metadata.licensePlate || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: userId,
      email: email,
      ...updateData
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('✅ Profile updated with protection data:');
  console.log('  has_protection:', true);
  console.log('  phone:', metadata.phone);
  console.log('  address:', metadata.address);
  console.log('  city_sticker_expiry:', metadata.citySticker);
  console.log('  license_plate_expiry:', metadata.licensePlate);
  console.log('\n🎉 Done!\n');
}

// Data from the Stripe webhook metadata
const email = 'helldolldarlings@gmail.com';
const metadata = {
  phone: '+12243217290',
  address: '2434 N Southport Ave',
  citySticker: '2025-10-31',
  licensePlate: '2025-12-31',
  hasPermitZone: false
};

fixProfile(email, metadata);
