const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function fixEmptyProfile(email) {
  console.log(`\n🔍 Checking profile for: ${email}\n`);

  // Get auth user
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const authUser = authUsers?.users.find(u => u.email === email);

  if (!authUser) {
    console.log('❌ User not found in auth.users');
    return;
  }

  console.log('✅ Found auth user:', authUser.id);

  // Get current profile
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', authUser.id);

  if (!profiles || profiles.length === 0) {
    console.log('❌ No profile found');
    return;
  }

  const profile = profiles[0];
  console.log('\n📋 Current profile:');
  console.log('  First Name:', profile.first_name || '(empty)');
  console.log('  Last Name:', profile.last_name || '(empty)');
  console.log('  Phone:', profile.phone_number || '(empty)');
  console.log('  License Plate:', profile.license_plate || '(empty)');
  console.log('  Address:', profile.home_address_full || '(empty)');
  console.log('  ZIP:', profile.zip_code || '(empty)');

  console.log('\n📝 Please provide the user\'s information:\n');

  const firstName = await question('First Name: ');
  const lastName = await question('Last Name: ');
  const phone = await question('Phone (10 digits): ');
  const licensePlate = await question('License Plate: ');
  const address = await question('Street Address: ');
  const zip = await question('ZIP Code: ');
  const vin = await question('VIN (optional, press enter to skip): ');
  const make = await question('Make (optional): ');
  const model = await question('Model (optional): ');

  const normalizedPhone = normalizePhoneNumber(phone);

  console.log('\n📋 Will update profile with:');
  console.log('  First Name:', firstName);
  console.log('  Last Name:', lastName);
  console.log('  Phone:', normalizedPhone);
  console.log('  License Plate:', licensePlate.toUpperCase());
  console.log('  Address:', address);
  console.log('  ZIP:', zip);
  if (vin) console.log('  VIN:', vin);
  if (make) console.log('  Make:', make);
  if (model) console.log('  Model:', model);

  const confirm = await question('\n❓ Proceed with update? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled');
    rl.close();
    return;
  }

  // Update users table
  const { error: usersError } = await supabase
    .from('users')
    .upsert({
      id: authUser.id,
      email,
      phone: normalizedPhone,
      first_name: firstName,
      last_name: lastName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'id'
    });

  if (usersError) {
    console.error('❌ Error updating users table:', usersError.message);
  } else {
    console.log('✅ Updated users table');
  }

  // Update user_profiles
  const updateData = {
    user_id: authUser.id,
    email,
    phone_number: normalizedPhone,
    first_name: firstName,
    last_name: lastName,
    zip_code: zip,
    license_plate: licensePlate.toUpperCase(),
    home_address_full: address,
    mailing_address: address,
    mailing_city: 'Chicago',
    mailing_state: 'IL',
    mailing_zip: zip,
    updated_at: new Date().toISOString()
  };

  const { error: profileError } = await supabase
    .from('user_profiles')
    .update(updateData)
    .eq('user_id', authUser.id);

  if (profileError) {
    console.error('❌ Error updating profile:', profileError.message);
  } else {
    console.log('✅ Updated user_profiles table');
  }

  // Create vehicle
  const vehicleData = {
    user_id: authUser.id,
    license_plate: licensePlate.toUpperCase(),
    zip_code: zip,
    subscription_status: 'active'
  };

  if (vin) vehicleData.vin = vin;
  if (make) vehicleData.make = make;
  if (model) vehicleData.model = model;

  const { error: vehicleError } = await supabase
    .from('vehicles')
    .upsert(vehicleData, {
      onConflict: 'user_id,license_plate'
    });

  if (vehicleError) {
    console.error('❌ Error creating vehicle:', vehicleError.message);
  } else {
    console.log('✅ Created/updated vehicle');
  }

  console.log('\n🎉 Profile updated successfully!');
  rl.close();
}

const email = process.argv[2] || 'countluigivampa@gmail.com';
fixEmptyProfile(email);
