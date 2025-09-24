#!/usr/bin/env node

// Verify user data is being saved correctly
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkUserData(email) {
  console.log(`\n🔍 Checking data for: ${email}`);
  console.log('=' . repeat(50));
  
  // Check users table
  console.log('\n📊 Users table:');
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  
  if (userError) {
    console.log('   ❌ No user found:', userError.message);
  } else {
    console.log('   ✅ User found:');
    console.log('      - ID:', userData.id);
    console.log('      - Email:', userData.email);
    console.log('      - Phone:', userData.phone || 'Not set');
    console.log('      - Email verified:', userData.email_verified);
  }
  
  // Check user_profiles table
  console.log('\n📊 User Profiles table:');
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userData?.id)
    .single();
  
  if (profileError) {
    console.log('   ❌ No profile found:', profileError.message);
  } else {
    console.log('   ✅ Profile found:');
    console.log('      - Name:', profileData.first_name, profileData.last_name);
    console.log('      - License Plate:', profileData.license_plate);
    console.log('      - Zip Code:', profileData.zip_code);
    console.log('      - City Sticker Expiry:', profileData.city_sticker_expiry);
  }
  
  // Check vehicles table
  console.log('\n📊 Vehicles table:');
  const { data: vehicleData, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', userData?.id);
  
  if (vehicleError || !vehicleData || vehicleData.length === 0) {
    console.log('   ❌ No vehicles found');
  } else {
    console.log(`   ✅ ${vehicleData.length} vehicle(s) found:`);
    vehicleData.forEach((v, i) => {
      console.log(`      Vehicle ${i + 1}:`);
      console.log('        - License Plate:', v.license_plate);
      console.log('        - VIN:', v.vin || 'Not set');
      console.log('        - Zip Code:', v.zip_code);
      console.log('        - Subscription Status:', v.subscription_status);
    });
  }
  
  // Check obligations table
  console.log('\n📊 Obligations table:');
  const { data: obligationData, error: obligationError } = await supabase
    .from('obligations')
    .select('*')
    .eq('user_id', userData?.id);
  
  if (obligationError || !obligationData || obligationData.length === 0) {
    console.log('   ❌ No obligations found');
  } else {
    console.log(`   ✅ ${obligationData.length} obligation(s) found:`);
    obligationData.forEach(o => {
      console.log(`      - ${o.type}: Due ${o.due_date}, Completed: ${o.completed}`);
    });
  }
  
  // Check vehicle_reminders table (legacy)
  console.log('\n📊 Vehicle Reminders table (legacy):');
  const { data: reminderData, error: reminderError } = await supabase
    .from('vehicle_reminders')
    .select('*')
    .eq('email', email);
  
  if (reminderError || !reminderData || reminderData.length === 0) {
    console.log('   ❌ No reminders found');
  } else {
    console.log(`   ✅ ${reminderData.length} reminder(s) found:`);
    reminderData.forEach(r => {
      console.log(`      - License Plate: ${r.license_plate}, Status: ${r.subscription_status}`);
    });
  }
}

async function listRecentUsers() {
  console.log('\n📅 Recent users (last 5):');
  console.log('=' . repeat(50));
  
  const { data, error } = await supabase
    .from('users')
    .select('email, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (error) {
    console.log('❌ Error fetching users:', error.message);
  } else if (data && data.length > 0) {
    data.forEach(u => {
      console.log(`   ${u.email} - Created: ${new Date(u.created_at).toLocaleString()}`);
    });
  } else {
    console.log('   No users found');
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    await listRecentUsers();
    console.log('\n💡 Usage: node verify-user-data.js <email>');
  } else {
    await checkUserData(args[0]);
  }
}

main().catch(console.error);