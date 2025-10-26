const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanup(email) {
  console.log(`\n🧹 Cleaning up test user: ${email}\n`);

  // Get auth user
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const authUser = authUsers?.users.find(u => u.email === email);

  if (!authUser) {
    console.log('❌ User not found in auth');
    return;
  }

  const userId = authUser.id;
  console.log('✅ Found auth user:', userId);

  // Delete from users table
  console.log('🗑️  Deleting from users table...');
  const { error: usersError } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);

  if (usersError && usersError.code !== 'PGRST116') {
    console.error('❌ Error:', usersError.message);
  } else {
    console.log('✅ Deleted from users');
  }

  // Delete from user_profiles
  console.log('🗑️  Deleting from user_profiles...');
  const { error: profileError } = await supabase
    .from('user_profiles')
    .delete()
    .eq('user_id', userId);

  if (profileError && profileError.code !== 'PGRST116') {
    console.error('❌ Error:', profileError.message);
  } else {
    console.log('✅ Deleted from user_profiles');
  }

  // Delete from vehicles
  console.log('🗑️  Deleting from vehicles...');
  const { error: vehiclesError } = await supabase
    .from('vehicles')
    .delete()
    .eq('user_id', userId);

  if (vehiclesError && vehiclesError.code !== 'PGRST116') {
    console.error('❌ Error:', vehiclesError.message);
  } else {
    console.log('✅ Deleted from vehicles');
  }

  // Delete pending signup
  console.log('🗑️  Deleting from pending_signups...');
  const { error: pendingError } = await supabase
    .from('pending_signups')
    .delete()
    .eq('email', email);

  if (pendingError && pendingError.code !== 'PGRST116') {
    console.error('❌ Error:', pendingError.message);
  } else {
    console.log('✅ Deleted from pending_signups');
  }

  // Delete from auth (THIS is what you were missing!)
  console.log('🗑️  Deleting from auth.users...');
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);

  if (authError) {
    console.error('❌ Error:', authError.message);
  } else {
    console.log('✅ Deleted from auth.users');
  }

  console.log('\n🎉 User completely cleaned up! Can be used as "new" signup.\n');
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node cleanup-test-user.js EMAIL');
  process.exit(1);
}

cleanup(email);
