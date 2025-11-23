#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function deleteUser(email) {
  console.log('🗑️  Deleting user:', email);
  console.log('');

  // Find user
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('Found user ID:', userId);

  // Delete from user_profiles first (foreign key constraint)
  const { error: profileError } = await supabase
    .from('user_profiles')
    .delete()
    .eq('user_id', userId);

  if (profileError) {
    console.log('⚠️  Profile delete:', profileError.message);
  } else {
    console.log('✅ Deleted from user_profiles');
  }

  // Delete from users table
  const { error: usersError } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);

  if (usersError) {
    console.log('⚠️  Users table delete:', usersError.message);
  } else {
    console.log('✅ Deleted from users table');
  }

  // Delete from user_consents
  const { error: consentsError } = await supabase
    .from('user_consents')
    .delete()
    .eq('user_id', userId);

  if (consentsError) {
    console.log('⚠️  Consents delete:', consentsError.message);
  } else {
    console.log('✅ Deleted from user_consents');
  }

  // Delete auth user last
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);

  if (authError) {
    console.log('❌ Auth delete failed:', authError.message);
  } else {
    console.log('✅ Deleted auth user');
  }

  console.log('');
  console.log('🎉 User completely deleted! Email can be reused now.');
}

const email = process.argv[2];

if (!email) {
  console.log('Usage: node scripts/delete-test-user.js EMAIL');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/delete-test-user.js mystreetcleaning+1@gmail.com');
  process.exit(1);
}

deleteUser(email).catch(console.error);
