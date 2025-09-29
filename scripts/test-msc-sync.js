#!/usr/bin/env node

// Comprehensive test suite for MyStreetCleaning sync
// Run: node scripts/test-msc-sync.js

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

const testEmail = `test_${Date.now()}@example.com`;

async function runTests() {
  console.log('🧪 MYSTREETCLEANING SYNC TEST SUITE\n');
  console.log('=' .repeat(60));
  console.log(`Test email: ${testEmail}\n`);
  
  // TEST 1: Create new user in TicketlessAmerica
  console.log('📝 TEST 1: New User Creation');
  console.log('-----------------------------');
  
  const newUser = {
    user_id: `test_${Date.now()}`,
    email: testEmail,
    home_address_full: '123 Test Street, Chicago, IL',
    home_address_ward: 99,
    home_address_section: 9,
    phone_number: '+13125551234',
    notify_sms: true,
    notify_email: true,
    notify_evening_before: true,
    follow_up_sms: true,
    notify_days_array: [0, 1, 2],
    created_at: new Date().toISOString()
  };
  
  console.log('Creating user in TicketlessAmerica...');
  const { error: createError } = await taSupabase
    .from('user_profiles')
    .insert(newUser);
    
  if (createError) {
    console.log('❌ Failed to create test user:', createError.message);
    return;
  }
  
  console.log('✅ User created in TicketlessAmerica');
  
  // Simulate profile save (which should trigger sync)
  console.log('\n🔄 Triggering profile sync...');
  
  const response = await fetch('https://ticketlessamerica.com/api/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: newUser.user_id,
      home_address_ward: 99,
      home_address_section: 9
    })
  });
  
  if (response.ok) {
    console.log('✅ Profile API called successfully');
  } else {
    console.log('⚠️  Profile API returned:', response.status);
  }
  
  // Wait a moment for sync
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Check if user exists in MyStreetCleaning
  console.log('\n🔍 Checking MyStreetCleaning database...');
  const { data: mscUser, error: mscError } = await mscSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', testEmail)
    .single();
    
  if (mscError && mscError.code !== 'PGRST116') {
    console.log('❌ Error checking MSC:', mscError.message);
  } else if (mscUser) {
    console.log('✅ USER FOUND IN MYSTREETCLEANING!');
    console.log('   Ward:', mscUser.home_address_ward, '(should be 99)');
    console.log('   Section:', mscUser.home_address_section, '(should be 9)');
    console.log('   SMS:', mscUser.notify_sms);
    console.log('   Evening before:', mscUser.notify_evening_before);
  } else {
    console.log('❌ User NOT found in MyStreetCleaning');
    console.log('   The sync may not have triggered properly');
  }
  
  // TEST 2: Update existing user
  console.log('\n📝 TEST 2: Profile Update Sync');
  console.log('-------------------------------');
  console.log('Updating ward/section in TicketlessAmerica...');
  
  const { error: updateError } = await taSupabase
    .from('user_profiles')
    .update({
      home_address_ward: 88,
      home_address_section: 8,
      notify_evening_before: false
    })
    .eq('email', testEmail);
    
  if (!updateError) {
    console.log('✅ Updated in TicketlessAmerica (Ward 88, Section 8)');
    
    // Trigger sync again
    await fetch('https://ticketlessamerica.com/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: newUser.user_id,
        home_address_ward: 88,
        home_address_section: 8,
        notify_evening_before: false
      })
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check MSC again
    const { data: updatedMSC } = await mscSupabase
      .from('user_profiles')
      .select('*')
      .eq('email', testEmail)
      .single();
      
    if (updatedMSC) {
      console.log('✅ MSC user updated:');
      console.log('   Ward:', updatedMSC.home_address_ward, '(should be 88)');
      console.log('   Section:', updatedMSC.home_address_section, '(should be 8)');
      console.log('   Evening before:', updatedMSC.notify_evening_before, '(should be false)');
    }
  }
  
  // Cleanup
  console.log('\n🧹 Cleaning up test data...');
  await taSupabase
    .from('user_profiles')
    .delete()
    .eq('email', testEmail);
    
  await mscSupabase
    .from('user_profiles')
    .delete()
    .eq('email', testEmail);
    
  console.log('✅ Test data cleaned up');
}

// Test Randy's specific case
async function testRandy() {
  console.log('\n📝 TEST: Randy\'s Profile Sync');
  console.log('------------------------------');
  
  // Check Randy in both databases
  const { data: taRandy } = await taSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  const { data: mscRandy } = await mscSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  console.log('\nTicketlessAmerica Randy:');
  console.log('  Ward:', taRandy?.home_address_ward);
  console.log('  Section:', taRandy?.home_address_section);
  console.log('  Address:', taRandy?.home_address_full);
  
  console.log('\nMyStreetCleaning Randy:');
  console.log('  Ward:', mscRandy?.home_address_ward);
  console.log('  Section:', mscRandy?.home_address_section);
  console.log('  Address:', mscRandy?.home_address_full);
  
  if (taRandy?.home_address_ward === mscRandy?.home_address_ward &&
      taRandy?.home_address_section === mscRandy?.home_address_section) {
    console.log('\n✅ Randy is properly synced!');
  } else {
    console.log('\n⚠️  Randy\'s ward/section don\'t match!');
    console.log('   Go to TicketlessAmerica settings and click Save to trigger sync');
  }
  
  // Check street cleaning schedule for Randy
  console.log('\n🧹 Randy\'s Street Cleaning Schedule:');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const { data: schedule } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('cleaning_date')
    .eq('ward', mscRandy?.home_address_ward || 43)
    .eq('section', mscRandy?.home_address_section || 1)
    .gte('cleaning_date', today.toISOString())
    .order('cleaning_date')
    .limit(5);
    
  if (schedule && schedule.length > 0) {
    schedule.forEach(s => {
      const date = new Date(s.cleaning_date);
      const days = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`  ${s.cleaning_date}: ${days} days away`);
    });
  } else {
    console.log('  No upcoming cleaning dates found');
  }
}

// Run tests
async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === '--randy') {
    await testRandy();
  } else if (args[0] === '--new') {
    await runTests();
  } else {
    console.log('Usage:');
    console.log('  node test-msc-sync.js --new    # Test new user creation');
    console.log('  node test-msc-sync.js --randy  # Check Randy\'s sync status');
    console.log('\nRunning Randy check by default...\n');
    await testRandy();
  }
}

main().catch(console.error);