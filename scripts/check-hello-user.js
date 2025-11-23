#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  const email = 'hellodolldarlings@gmail.com';
  
  console.log('🔍 Checking for:', email);
  
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const authUser = users.find(u => u.email === email);
  
  if (authUser) {
    console.log('\n✅ Found in auth.users:');
    console.log('  ID:', authUser.id);
    console.log('  Created:', authUser.created_at);
    console.log('  Last sign in:', authUser.last_sign_in_at);
    
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .single();
      
    if (profile) {
      console.log('\n✅ user_profiles exists');
      console.log('  License plate:', profile.license_plate);
    } else {
      console.log('\n❌ NO user_profiles record');
    }
  } else {
    console.log('\n❌ User NOT found');
  }
}

checkUser().catch(console.error);
