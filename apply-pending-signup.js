const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizePhoneNumber(phone) {
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  if (phone.startsWith('+')) {
    return phone;
  }
  return `+1${digitsOnly}`;
}

async function apply(email) {
  console.log(`\n🔍 Applying pending signup for: ${email}\n`);

  // Get pending signup
  const { data: pending, error: pendingError } = await supabase
    .from('pending_signups')
    .select('*')
    .eq('email', email)
    .single();

  if (pendingError) {
    console.error('❌ No pending signup found:', pendingError.message);
    return;
  }

  console.log('✅ Found pending signup data');

  // Get auth user
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const authUser = authUsers?.users.find(u => u.email === email);

  if (!authUser) {
    console.error('❌ User not found in auth');
    return;
  }

  const userId = authUser.id;
  console.log('✅ Found auth user:', userId);

  const normalizedPhone = normalizePhoneNumber(pending.phone);

  // Update users table
  console.log('\n📝 Updating users table...');
  const { error: usersError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      email,
      phone: normalizedPhone,
      first_name: pending.first_name,
      last_name: pending.last_name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'id'
    });

  if (usersError) {
    console.error('❌ Users table error:', usersError.message);
  } else {
    console.log('✅ Updated users table');
  }

  // Update user_profiles
  console.log('📝 Updating user_profiles...');
  const { error: profileError } = await supabase
    .from('user_profiles')
    .update({
      phone_number: normalizedPhone,
      first_name: pending.first_name,
      last_name: pending.last_name,
      zip_code: pending.zip,
      license_plate: pending.license_plate?.toUpperCase(),
      home_address_full: pending.address,
      mailing_address: pending.address,
      mailing_city: 'Chicago',
      mailing_state: 'IL',
      mailing_zip: pending.zip,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (profileError) {
    console.error('❌ Profile error:', profileError.message);
  } else {
    console.log('✅ Updated user_profiles');
  }

  // Create vehicle
  console.log('📝 Creating vehicle...');
  const vehicleData = {
    user_id: userId,
    license_plate: pending.license_plate?.toUpperCase(),
    zip_code: pending.zip,
    subscription_status: 'active'
  };

  if (pending.vin) vehicleData.vin = pending.vin;
  if (pending.make) vehicleData.make = pending.make;
  if (pending.model) vehicleData.model = pending.model;
  if (pending.city_sticker) vehicleData.city_sticker_expiry = pending.city_sticker;

  const { error: vehicleError } = await supabase
    .from('vehicles')
    .upsert(vehicleData, {
      onConflict: 'user_id,license_plate'
    });

  if (vehicleError) {
    console.error('❌ Vehicle error:', vehicleError.message);
  } else {
    console.log('✅ Created vehicle');
  }

  // Delete pending signup
  console.log('🗑️  Deleting pending signup...');
  const { error: deleteError } = await supabase
    .from('pending_signups')
    .delete()
    .eq('email', email);

  if (deleteError) {
    console.error('❌ Delete error:', deleteError.message);
  } else {
    console.log('✅ Deleted pending signup');
  }

  console.log('\n🎉 Done! Profile has been populated from pending signup data.');
}

apply(process.argv[2] || 'countluigivampa@gmail.com');
