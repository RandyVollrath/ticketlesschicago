#!/usr/bin/env node

// Check MyStreetCleaning.com database schema
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const MSC_SUPABASE_URL = process.env.MSC_SUPABASE_URL;
const MSC_SUPABASE_SERVICE_ROLE_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

async function checkSchema() {
  const supabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  console.log('Checking MyStreetCleaning.com Database Schema');
  console.log('=============================================\n');
  
  // Check user_profiles table
  console.log('📊 Checking user_profiles table...');
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .limit(1);
  
  if (profileError) {
    console.error('❌ Could not query user_profiles:', profileError.message);
  } else if (profileData && profileData.length > 0) {
    console.log('✅ user_profiles columns:', Object.keys(profileData[0]));
  } else {
    console.log('⚠️ user_profiles table is empty');
  }
  
  // Check user_addresses table
  console.log('\n📊 Checking user_addresses table...');
  const { data: addressData, error: addressError } = await supabase
    .from('user_addresses')
    .select('*')
    .limit(1);
  
  if (addressError) {
    console.error('❌ Could not query user_addresses:', addressError.message);
  } else if (addressData && addressData.length > 0) {
    console.log('✅ user_addresses columns:', Object.keys(addressData[0]));
  } else {
    console.log('⚠️ user_addresses table is empty');
  }
  
  // Try to get any existing user to understand the structure
  console.log('\n📊 Sample user data...');
  const { data: sampleUser, error: sampleError } = await supabase
    .from('user_profiles')
    .select('*')
    .limit(3);
  
  if (sampleUser && sampleUser.length > 0) {
    console.log('Sample user (first 3 fields):', {
      ...Object.fromEntries(Object.entries(sampleUser[0]).slice(0, 3)),
      '...': '(more fields)'
    });
  }
}

checkSchema().catch(console.error);