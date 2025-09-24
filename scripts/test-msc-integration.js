#!/usr/bin/env node

// Test MyStreetCleaning.com Integration
require('dotenv').config({ path: '.env.local' });

const MSC_SUPABASE_URL = process.env.MSC_SUPABASE_URL;
const MSC_SUPABASE_SERVICE_ROLE_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing MyStreetCleaning.com Integration');
console.log('=========================================');
console.log('MSC_SUPABASE_URL:', MSC_SUPABASE_URL ? '✅ Set' : '❌ Not set');
console.log('MSC_SUPABASE_SERVICE_ROLE_KEY:', MSC_SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Not set');

if (!MSC_SUPABASE_URL || !MSC_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Missing environment variables!');
  console.error('Please ensure MSC_SUPABASE_URL and MSC_SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');

async function testConnection() {
  console.log('\n📡 Testing connection to MyStreetCleaning database...');
  
  try {
    const supabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Test query
    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id')
      .limit(1);
    
    if (error) {
      console.error('❌ Connection failed:', error.message);
      return false;
    }
    
    console.log('✅ Successfully connected to MyStreetCleaning database!');
    return true;
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return false;
  }
}

async function testCreateAccount() {
  console.log('\n🧪 Testing account creation...');
  
  const { syncUserToMyStreetCleaning } = require('../lib/mystreetcleaning-integration.ts');
  
  const testEmail = `test_${Date.now()}@ticketlesstest.com`;
  const testAddress = '123 Test St, Chicago, IL 60601';
  
  console.log('Creating test account:', testEmail);
  
  const result = await syncUserToMyStreetCleaning(
    testEmail,
    testAddress,
    'test_user_id'
  );
  
  if (result.success) {
    console.log('✅ Test account created successfully!');
    console.log('Account ID:', result.accountId);
  } else {
    console.error('❌ Failed to create test account:', result.error);
  }
  
  return result.success;
}

async function main() {
  const connectionOk = await testConnection();
  
  if (connectionOk) {
    await testCreateAccount();
  }
  
  console.log('\n=========================================');
  console.log('Test completed');
}

main().catch(console.error);