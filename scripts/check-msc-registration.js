#!/usr/bin/env node

// Check if Randy is registered in MyStreetCleaning for notifications
// Run: node scripts/check-msc-registration.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

async function checkMSCRegistration() {
  console.log('🔍 CHECKING MYSTREETCLEANING REGISTRATION\n');
  console.log('=' .repeat(60));
  
  // Connect to MyStreetCleaning database
  const mscUrl = process.env.MSC_SUPABASE_URL;
  const mscKey = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!mscUrl || !mscKey) {
    console.log('❌ Missing MSC_SUPABASE_URL or MSC_SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  
  const mscSupabase = createClient(mscUrl, mscKey);
  
  // Check if Randy exists in MSC user_profiles
  console.log('📊 Checking MyStreetCleaning user_profiles for Randy...\n');
  
  const { data: mscUser, error: mscError } = await mscSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  if (mscError && mscError.code !== 'PGRST116') {
    console.log('❌ Error checking MSC database:', mscError.message);
    return;
  }
  
  if (!mscUser) {
    console.log('❌ Randy NOT found in MyStreetCleaning database!');
    console.log('   This is why street cleaning notifications aren\'t sending.');
    console.log('\n✅ SOLUTION: Register Randy in MyStreetCleaning');
    
    // Show what data we would sync
    console.log('\n📝 Data to sync from TicketlessAmerica:');
    console.log('  Email: randyvollrath@gmail.com');
    console.log('  Address: 1013 W Webster Ave');
    console.log('  Ward: 43');
    console.log('  Section: 1');
    console.log('  Phone: 13125354254');
    console.log('  notify_days_array: [0, 1, 2, 3]');
    console.log('  notify_evening_before: true');
    console.log('  notify_sms: true');
    console.log('  follow_up_sms: true');
    
  } else {
    console.log('✅ Randy found in MyStreetCleaning!');
    console.log('\n📋 MSC Profile:');
    console.log(`  User ID: ${mscUser.user_id}`);
    console.log(`  Email: ${mscUser.email}`);
    console.log(`  Address: ${mscUser.home_address_full || 'NOT SET'}`);
    console.log(`  Ward: ${mscUser.home_address_ward || 'NOT SET'}`);
    console.log(`  Section: ${mscUser.home_address_section || 'NOT SET'}`);
    console.log(`  Phone: ${mscUser.phone_number || mscUser.phone || 'NOT SET'}`);
    console.log(`  SMS Enabled: ${mscUser.notify_sms}`);
    console.log(`  Evening Before: ${mscUser.notify_evening_before}`);
    console.log(`  Follow-up SMS: ${mscUser.follow_up_sms}`);
    console.log(`  Notify Days: ${JSON.stringify(mscUser.notify_days_array)}`);
    
    // Check if notification settings match
    const issues = [];
    if (!mscUser.home_address_ward || mscUser.home_address_ward !== 43) {
      issues.push('Ward not set to 43');
    }
    if (!mscUser.home_address_section || mscUser.home_address_section !== 1) {
      issues.push('Section not set to 1');
    }
    if (!mscUser.notify_sms) {
      issues.push('SMS notifications disabled');
    }
    if (!mscUser.phone_number && !mscUser.phone) {
      issues.push('No phone number');
    }
    
    if (issues.length > 0) {
      console.log('\n⚠️  Issues found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
      console.log('\n💡 Need to update MSC profile with correct data');
    } else {
      console.log('\n✅ Everything looks good!');
      console.log('   MyStreetCleaning should be sending notifications');
      
      // Check if MSC has cron jobs running
      console.log('\n⏰ MyStreetCleaning notification times:');
      console.log('  - Evening before (7 PM Chicago)');
      console.log('  - Morning of (7 AM Chicago)');
      console.log('  - Follow-up after (3 PM Chicago)');
      console.log('\n❓ Are the MyStreetCleaning cron jobs running?');
    }
  }
  
  // Check user_addresses table too
  console.log('\n📍 Checking MSC user_addresses table...');
  const { data: addresses, error: addrError } = await mscSupabase
    .from('user_addresses')
    .select('*')
    .or(`user_id.eq.${mscUser?.user_id || 'none'},full_address.ilike.%1013 W Webster%`);
    
  if (addresses && addresses.length > 0) {
    console.log(`Found ${addresses.length} address(es):`);
    addresses.forEach(addr => {
      console.log(`  - ${addr.full_address} (User: ${addr.user_id})`);
    });
  } else {
    console.log('No addresses found for Randy');
  }
}

checkMSCRegistration().catch(console.error);