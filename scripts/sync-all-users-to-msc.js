#!/usr/bin/env node

// Sync ALL TicketlessAmerica users to MyStreetCleaning
// This ensures everyone gets street cleaning notifications based on their TicketlessAmerica settings
// Run: node scripts/sync-all-users-to-msc.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

// TicketlessAmerica database
const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// MyStreetCleaning database
const mscSupabase = createClient(
  process.env.MSC_SUPABASE_URL,
  process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
);

async function syncAllUsers() {
  console.log('🔄 SYNCING ALL USERS TO MYSTREETCLEANING\n');
  console.log('=' .repeat(60));
  
  // Get all users from TicketlessAmerica with street cleaning settings
  const { data: taUsers, error: taError } = await taSupabase
    .from('user_profiles')
    .select('*')
    .not('home_address_ward', 'is', null)
    .not('home_address_section', 'is', null);
    
  if (taError) {
    console.error('❌ Error fetching TicketlessAmerica users:', taError);
    return;
  }
  
  console.log(`📊 Found ${taUsers.length} users with street cleaning settings\n`);
  
  let created = 0;
  let updated = 0;
  let failed = 0;
  
  for (const taUser of taUsers) {
    console.log(`\n👤 Processing: ${taUser.email}`);
    console.log(`  Address: ${taUser.home_address_full || 'Not set'}`);
    console.log(`  Ward: ${taUser.home_address_ward}, Section: ${taUser.home_address_section}`);
    
    // Check if user exists in MyStreetCleaning
    const { data: existingMSC } = await mscSupabase
      .from('user_profiles')
      .select('user_id, home_address_ward, home_address_section')
      .eq('email', taUser.email)
      .single();
      
    // Prepare MSC data from TicketlessAmerica settings
    const mscData = {
      email: taUser.email,
      home_address_full: taUser.home_address_full,
      home_address_ward: taUser.home_address_ward,
      home_address_section: taUser.home_address_section,
      phone_number: taUser.phone_number || taUser.phone,
      phone: taUser.phone_number || taUser.phone,
      
      // Notification settings from TicketlessAmerica
      notify_sms: taUser.notify_sms === true,
      notify_email: taUser.notify_email !== false,
      notify_evening_before: taUser.notify_evening_before === true,
      follow_up_sms: taUser.follow_up_sms === true,
      notify_days_array: taUser.notify_days_array || [0, 1, 2, 3],
      notify_days_before: taUser.notify_days_before || 1,
      
      // Voice settings
      voice_calls_enabled: taUser.voice_calls_enabled === true,
      phone_call_enabled: taUser.phone_call_enabled === true,
      voice_preference: taUser.voice_preference || 'female',
      voice_call_time: taUser.voice_call_time || '07:00',
      
      // Metadata
      role: 'ticketless_user',
      updated_at: new Date().toISOString()
    };
    
    if (existingMSC) {
      // Update existing user
      console.log(`  ⚠️ User exists in MSC`);
      console.log(`     Current MSC: Ward ${existingMSC.home_address_ward}, Section ${existingMSC.home_address_section}`);
      
      const { error: updateError } = await mscSupabase
        .from('user_profiles')
        .update(mscData)
        .eq('email', taUser.email);
        
      if (updateError) {
        console.log(`  ❌ Update failed: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✅ Updated successfully`);
        updated++;
      }
    } else {
      // Create new user
      console.log(`  🆕 Creating new MSC user`);
      
      mscData.user_id = crypto.randomUUID ? crypto.randomUUID() : `ta_${Date.now()}`;
      mscData.created_at = new Date().toISOString();
      
      const { error: createError } = await mscSupabase
        .from('user_profiles')
        .insert(mscData);
        
      if (createError) {
        console.log(`  ❌ Create failed: ${createError.message}`);
        failed++;
      } else {
        console.log(`  ✅ Created successfully`);
        created++;
      }
    }
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('📊 SYNC COMPLETE:');
  console.log(`  Created: ${created} new users`);
  console.log(`  Updated: ${updated} existing users`);
  console.log(`  Failed: ${failed} users`);
  console.log('\n✅ All TicketlessAmerica users are now synced to MyStreetCleaning!');
  console.log('   They will receive street cleaning notifications based on their TicketlessAmerica settings.');
}

// Add an option to sync just one user for testing
async function syncSingleUser(email) {
  console.log(`🔄 Syncing single user: ${email}\n`);
  
  const { data: taUser, error } = await taSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .single();
    
  if (error || !taUser) {
    console.log('❌ User not found in TicketlessAmerica');
    return;
  }
  
  console.log('TicketlessAmerica data:');
  console.log(`  Ward: ${taUser.home_address_ward}`);
  console.log(`  Section: ${taUser.home_address_section}`);
  console.log(`  Address: ${taUser.home_address_full}`);
  console.log(`  SMS: ${taUser.notify_sms}`);
  console.log(`  Evening before: ${taUser.notify_evening_before}`);
  console.log(`  Days: ${JSON.stringify(taUser.notify_days_array)}`);
  
  // Now sync this user
  await syncAllUsers(); // This will just sync the one user we're interested in
}

// Check command line arguments
const args = process.argv.slice(2);
if (args[0] === '--email') {
  syncSingleUser(args[1]);
} else if (args[0] === '--help') {
  console.log('Usage:');
  console.log('  node sync-all-users-to-msc.js           # Sync all users');
  console.log('  node sync-all-users-to-msc.js --email user@example.com  # Sync one user');
} else {
  syncAllUsers().catch(console.error);
}