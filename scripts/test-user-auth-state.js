#!/usr/bin/env node

// Test the auth state for a specific user
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkUserAuthState(email) {
  console.log(`🔍 Checking auth state for: ${email}`);
  console.log('=' . repeat(50));
  
  try {
    // Get user by email
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error listing users:', listError);
      return;
    }
    
    const user = users.users.find(u => u.email === email);
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('✅ User found:');
    console.log('   ID:', user.id);
    console.log('   Email:', user.email);
    console.log('   Email confirmed:', user.email_confirmed_at ? 'Yes' : 'No');
    console.log('   Created:', new Date(user.created_at).toLocaleString());
    console.log('   Last sign in:', user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Never');
    console.log('   OAuth provider:', user.app_metadata?.provider || 'None');
    
    if (user.user_metadata && Object.keys(user.user_metadata).length > 0) {
      console.log('   User metadata:', JSON.stringify(user.user_metadata, null, 2));
    } else {
      console.log('   User metadata: None');
    }
    
    // Check if they have a profile/vehicle data
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (userData) {
      console.log('   Profile exists: Yes');
    } else {
      console.log('   Profile exists: No');
    }
    
    // Check vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('license_plate, subscription_status')
      .eq('user_id', user.id);
    
    console.log('   Vehicles:', vehicles?.length || 0);
    if (vehicles && vehicles.length > 0) {
      vehicles.forEach(v => {
        console.log(`     - ${v.license_plate} (${v.subscription_status})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function main() {
  const email = process.argv[2];
  
  if (!email) {
    console.log('Usage: node test-user-auth-state.js <email>');
    console.log('Example: node test-user-auth-state.js hellosexdollnow@gmail.com');
    return;
  }
  
  await checkUserAuthState(email);
}

main().catch(console.error);