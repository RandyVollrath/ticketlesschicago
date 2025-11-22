#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  const email = 'hiautopilogamerica@gmail.com';

  console.log('🔍 Checking for user:', email);
  console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('');

  // Check if user exists in auth.users
  const { data: { users }, error } = await supabase.auth.admin.listUsers();

  if (error) {
    console.error('❌ Error listing users:', error);
    return;
  }

  const user = users.find(u => u.email === email);

  if (user) {
    console.log('✅ User EXISTS in auth.users:');
    console.log('  ID:', user.id);
    console.log('  Email:', user.email);
    console.log('  Created:', user.created_at);
    console.log('  Email confirmed:', user.email_confirmed_at ? 'Yes' : 'No');
    console.log('  Last sign in:', user.last_sign_in_at || 'Never');
    console.log('  Providers:', user.app_metadata.providers || user.identities?.map(i => i.provider));
    console.log('');

    // Check if they have a profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (profile) {
      console.log('✅ User profile EXISTS');
      console.log('  Has protection:', profile.has_protection);
      console.log('  Phone:', profile.phone_number || 'Not set');
    } else {
      console.log('⚠️  NO user profile found');
    }
  } else {
    console.log('❌ User NOT FOUND in database');
    console.log('This user needs to sign up first.');
  }

  console.log('');
  console.log('🔐 OAuth Configuration Check:');
  console.log('Make sure these URLs are whitelisted in Supabase Dashboard:');
  console.log('  → http://localhost:3001/auth/callback');
  console.log('  → http://localhost:3000/auth/callback');
  console.log('  → https://autopilotamerica.com/auth/callback');
  console.log('');
  console.log('Check at: https://supabase.com/dashboard → Authentication → URL Configuration');
}

checkUser().catch(console.error);
