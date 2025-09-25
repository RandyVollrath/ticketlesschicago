#!/usr/bin/env node

// Manually populate profile data for the most recent user to test the flow
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixRecentUserData() {
  console.log('🔧 MANUALLY FIXING RECENT USER DATA');
  console.log('==================================\n');

  try {
    // Find the most recent user (likely the one you just created)
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    console.log('📊 RECENT USERS:');
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (${user.created_at})`);
      console.log(`   Phone: ${user.phone || 'MISSING'}`);
      console.log(`   Name: ${user.first_name || 'MISSING'} ${user.last_name || 'MISSING'}`);
      console.log(`   Street Address: ${user.street_address || 'MISSING'}`);
      console.log('');
    });

    // Ask which user to fix (for now, let's fix the most recent one)
    const userToFix = users[0];
    console.log(`🎯 FIXING USER: ${userToFix.email}\n`);

    // Complete form data that should have been saved
    const completeData = {
      phone: '312-555-1234',
      first_name: 'Test',
      last_name: 'User',
      license_plate: 'TEST123',
      vin: '1HGCM82633A001122', 
      zip_code: '60601',
      vehicle_type: 'passenger',
      vehicle_year: 2022,
      city_sticker_expiry: '2025-07-31',
      license_plate_expiry: '2025-12-31', 
      emissions_date: '2025-06-30',
      street_address: '123 Main St, Chicago, IL 60601',
      mailing_address: '123 Main St',
      mailing_city: 'Chicago',
      mailing_state: 'IL',
      mailing_zip: '60601',
      concierge_service: true,
      city_stickers_only: false,
      spending_limit: 500,
      notification_preferences: {
        email: true,
        sms: true,
        voice: true,
        reminder_days: [60, 30, 14, 7, 3, 1] // Include 60 day reminder
      }
    };

    // Update the user with complete data
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(completeData)
      .eq('id', userToFix.id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Error updating user:', updateError);
      return;
    }

    console.log('✅ USER DATA UPDATED SUCCESSFULLY!');
    console.log('Updated fields:');
    Object.keys(completeData).forEach(key => {
      if (key === 'notification_preferences') {
        console.log(`   ${key}:`, JSON.stringify(completeData[key]));
      } else {
        console.log(`   ${key}: ${completeData[key]}`);
      }
    });

    console.log('\n🎉 SUCCESS! Now check the settings page to see if all fields are populated.');
    console.log('If they are, then we know the data flow works and the issue is just the webhook.');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

fixRecentUserData().catch(console.error);