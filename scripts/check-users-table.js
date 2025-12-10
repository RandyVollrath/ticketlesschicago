#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUsersTable() {
  const email = 'hellodolldarlings@gmail.com';
  
  console.log('🔍 Checking users table structure...\n');
  
  // Get auth user
  const { data: { users: authUsers } } = await supabase.auth.admin.listUsers();
  const authUser = authUsers.find(u => u.email === email);
  
  if (!authUser) {
    console.log('❌ Auth user not found');
    return;
  }
  
  console.log(`✅ Auth user ID: ${authUser.id}`);
  console.log(`   Email: ${authUser.email}\n`);
  
  // Check if there's a users table (public schema)
  const { data: publicUser, error: publicError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();
    
  if (publicError) {
    console.log('❌ Error querying public.users:', publicError.message);
    console.log('   Code:', publicError.code);
  } else if (publicUser) {
    console.log('✅ Found in public.users table:');
    console.log(JSON.stringify(publicUser, null, 2));
  } else {
    console.log('⚠️  Not found in public.users table');
  }
  
  // List all users in public.users
  const { data: allPublicUsers, error: allError } = await supabase
    .from('users')
    .select('id, email, phone');
    
  if (allError) {
    console.log('\n❌ Error querying all public.users:', allError.message);
  } else {
    console.log(`\n📊 Total records in public.users: ${allPublicUsers?.length || 0}`);
    if (allPublicUsers && allPublicUsers.length > 0) {
      console.log('\nSample records:');
      allPublicUsers.slice(0, 5).forEach((u, i) => {
        console.log(`${i + 1}. ID: ${u.id}, Email: ${u.email}, Phone: ${u.phone}`);
      });
    }
  }
}

checkUsersTable().catch(console.error);
