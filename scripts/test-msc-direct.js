#!/usr/bin/env node

// Direct test of MyStreetCleaning.com Integration
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const MSC_SUPABASE_URL = process.env.MSC_SUPABASE_URL;
const MSC_SUPABASE_SERVICE_ROLE_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing MyStreetCleaning.com Direct Integration');
console.log('===============================================');

if (!MSC_SUPABASE_URL || !MSC_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

async function testDirectCreation() {
  const supabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  const testEmail = `test_${Date.now()}@ticketlesstest.com`;
  const testAddress = '123 Test St, Chicago, IL 60601';
  const userId = `msc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log('\n1️⃣ Creating user profile...');
  console.log('   Email:', testEmail);
  console.log('   User ID:', userId);
  
  // Create user profile
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      user_id: userId,
      email: testEmail,
      sms_enabled: false,
      email_enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: 'ticketlessamerica',
      is_paid: false
    })
    .select()
    .single();
  
  if (profileError) {
    console.error('❌ Failed to create user profile:', profileError.message);
    return false;
  }
  
  console.log('✅ User profile created successfully!');
  
  console.log('\n2️⃣ Adding address...');
  console.log('   Address:', testAddress);
  
  // Add address
  const { data: addressData, error: addressError } = await supabase
    .from('user_addresses')
    .insert({
      user_id: userId,
      full_address: testAddress,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (addressError) {
    console.error('❌ Failed to add address:', addressError.message);
    // Don't fail completely if address fails
  } else {
    console.log('✅ Address added successfully!');
  }
  
  console.log('\n3️⃣ Verifying creation...');
  
  // Verify the user was created
  const { data: verifyData, error: verifyError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (verifyError || !verifyData) {
    console.error('❌ Verification failed:', verifyError?.message);
    return false;
  }
  
  console.log('✅ User verified in database!');
  console.log('   Created user:', verifyData.email);
  console.log('   User ID:', verifyData.user_id);
  
  // Clean up test user (optional)
  console.log('\n4️⃣ Cleaning up test data...');
  
  // Delete address first due to foreign key
  await supabase
    .from('user_addresses')
    .delete()
    .eq('user_id', userId);
  
  // Delete user profile
  const { error: deleteError } = await supabase
    .from('user_profiles')
    .delete()
    .eq('user_id', userId);
  
  if (deleteError) {
    console.error('⚠️ Could not clean up test data:', deleteError.message);
  } else {
    console.log('✅ Test data cleaned up');
  }
  
  return true;
}

async function main() {
  console.log('MSC_SUPABASE_URL:', MSC_SUPABASE_URL ? '✅ Set' : '❌ Not set');
  console.log('MSC_SUPABASE_SERVICE_ROLE_KEY:', MSC_SUPABASE_SERVICE_ROLE_KEY ? '✅ Set (hidden)' : '❌ Not set');
  
  const success = await testDirectCreation();
  
  console.log('\n===============================================');
  console.log(success ? '✅ All tests passed!' : '❌ Some tests failed');
}

main().catch(console.error);