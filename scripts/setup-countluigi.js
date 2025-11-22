const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: user } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'countluigivampa@gmail.com')
    .single();

  if (!user) {
    console.log('User not found');
    return;
  }

  console.log('✅ Found Count Luigi:');
  console.log('  Email:', user.email);
  console.log('  Stripe Customer:', user.stripe_customer_id || 'NOT SET');
  console.log('  Has Protection:', user.has_protection);
  console.log('  Vehicle Type:', user.vehicle_type || 'NOT SET');
  console.log('  License Plate:', user.license_plate || 'NOT SET');
  console.log('  City Sticker Expiry:', user.city_sticker_expiry || 'NOT SET');

  if (!user.stripe_customer_id) {
    console.log('\n❌ No Stripe customer - signup incomplete');
    return;
  }

  const testExpiry = new Date();
  testExpiry.setDate(testExpiry.getDate() + 25);
  const expiryStr = testExpiry.toISOString().split('T')[0];

  console.log('\n📅 Setting expiry to:', expiryStr, '(25 days from now)');

  await supabase.from('user_profiles').update({
    city_sticker_expiry: expiryStr,
    vehicle_type: user.vehicle_type || 'P',
    license_plate: user.license_plate || 'COUNT01'
  }).eq('user_id', user.user_id);

  console.log('✅ Updated! Ready to test cron job.\n');
})();
