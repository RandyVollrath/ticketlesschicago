#!/usr/bin/env node

// Debug what columns exist in the users table
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabaseSchema() {
  console.log('🔍 CHECKING DATABASE SCHEMA');
  console.log('============================\n');

  try {
    // Try to get any user record to see what columns exist
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Error querying users table:', error);
      return;
    }

    if (users && users.length > 0) {
      const sampleUser = users[0];
      console.log('✅ EXISTING COLUMNS IN USERS TABLE:');
      console.log(Object.keys(sampleUser).sort().join(', '));
      
      console.log('\n📊 SAMPLE USER DATA:');
      console.log(JSON.stringify(sampleUser, null, 2));
    } else {
      console.log('ℹ️ No users found in table');
    }

    // Check what the webhook is trying to insert
    console.log('\n🔧 WEBHOOK IS TRYING TO INSERT THESE FIELDS:');
    const webhookFields = [
      'id', 'email', 'phone', 'first_name', 'last_name',
      'notification_preferences', 'license_plate', 'vin', 'zip_code',
      'vehicle_type', 'vehicle_year', 'city_sticker_expiry',
      'license_plate_expiry', 'emissions_date', 'street_address',
      'mailing_address', 'mailing_city', 'mailing_state', 'mailing_zip',
      'concierge_service', 'city_stickers_only', 'spending_limit',
      'email_verified', 'phone_verified'
    ];
    console.log(webhookFields.sort().join(', '));

    // Check vehicles table too
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('*')
      .limit(1);

    if (!vehiclesError && vehicles && vehicles.length > 0) {
      console.log('\n🚗 VEHICLES TABLE COLUMNS:');
      console.log(Object.keys(vehicles[0]).sort().join(', '));
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkDatabaseSchema().catch(console.error);