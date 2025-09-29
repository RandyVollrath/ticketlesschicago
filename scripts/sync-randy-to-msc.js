#!/usr/bin/env node

// Sync Randy's correct address data to MyStreetCleaning
// Run: node scripts/sync-randy-to-msc.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

async function syncRandyToMSC() {
  console.log('🔄 SYNCING RANDY TO MYSTREETCLEANING\n');
  console.log('=' .repeat(60));
  
  // Connect to MyStreetCleaning database
  const mscUrl = process.env.MSC_SUPABASE_URL;
  const mscKey = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!mscUrl || !mscKey) {
    console.log('❌ Missing MSC credentials');
    return;
  }
  
  const mscSupabase = createClient(mscUrl, mscKey);
  
  // Randy's CORRECT data from TicketlessAmerica
  const correctData = {
    email: 'randyvollrath@gmail.com',
    home_address_full: '1013 W Webster Ave',
    home_address_ward: 43,
    home_address_section: 1,
    phone_number: '+13125354254', // Randy's actual phone from TicketlessAmerica
    notify_sms: true,
    notify_email: true,
    notify_evening_before: true,
    follow_up_sms: true,
    notify_days_array: [0, 1, 2, 3],
    notify_days_before: 1,
    phone_call_enabled: true,
    voice_calls_enabled: true,
    voice_preference: 'male',
    voice_call_time: '07:30',
    updated_at: new Date().toISOString()
  };
  
  console.log('📝 Updating MyStreetCleaning profile with:');
  console.log(`  Address: ${correctData.home_address_full}`);
  console.log(`  Ward: ${correctData.home_address_ward}`);
  console.log(`  Section: ${correctData.home_address_section}`);
  console.log(`  Phone: ${correctData.phone_number}`);
  
  // Update the user_profiles table
  const { data: updateResult, error: updateError } = await mscSupabase
    .from('user_profiles')
    .update(correctData)
    .eq('email', 'randyvollrath@gmail.com')
    .select();
    
  if (updateError) {
    console.log('\n❌ Error updating profile:', updateError.message);
    return;
  }
  
  console.log('\n✅ Successfully updated MyStreetCleaning profile!');
  
  if (updateResult && updateResult[0]) {
    const userId = updateResult[0].user_id;
    
    // Also add/update the address in user_addresses table
    console.log('\n📍 Updating user_addresses table...');
    
    // Check if this address already exists
    const { data: existingAddr } = await mscSupabase
      .from('user_addresses')
      .select('*')
      .eq('user_id', userId)
      .eq('full_address', '1013 W Webster Ave')
      .single();
      
    if (!existingAddr) {
      // Add the new address
      const { error: addrError } = await mscSupabase
        .from('user_addresses')
        .insert({
          user_id: userId,
          full_address: '1013 W Webster Ave',
          label: 'Home (from TicketlessAmerica)',
          ward: 43,
          section: 1,
          notify_days_array: [0, 1, 2, 3],
          created_at: new Date().toISOString()
        });
        
      if (addrError) {
        console.log('❌ Error adding address:', addrError.message);
      } else {
        console.log('✅ Added 1013 W Webster Ave to user_addresses');
      }
    } else {
      console.log('✅ Address already exists in user_addresses');
    }
  }
  
  // Check upcoming street cleaning for Ward 43, Section 1
  console.log('\n🧹 Checking upcoming street cleaning for Ward 43, Section 1...');
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const { data: schedule } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('cleaning_date')
    .eq('ward', 43)
    .eq('section', 1)
    .gte('cleaning_date', today.toISOString())
    .order('cleaning_date', { ascending: true })
    .limit(5);
    
  if (schedule && schedule.length > 0) {
    console.log('\nNext cleaning dates:');
    schedule.forEach(s => {
      const date = new Date(s.cleaning_date);
      const days = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const willNotify = [0, 1, 2, 3].includes(days);
      console.log(`  ${s.cleaning_date}: ${days} days away ${willNotify ? '📨 Will notify' : ''}`);
    });
    
    console.log('\n🎉 SUCCESS!');
    console.log('Randy will now receive MyStreetCleaning notifications for Ward 43, Section 1!');
    console.log('\n⏰ Notification schedule:');
    console.log('  - Evening before at 7 PM (if enabled)');
    console.log('  - Morning of at 7 AM');
    console.log('  - Follow-up at 3 PM (if enabled)');
  } else {
    console.log('No upcoming cleaning dates found for Ward 43, Section 1');
  }
}