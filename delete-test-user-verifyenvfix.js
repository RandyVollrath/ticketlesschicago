const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function deleteTestUser() {
  const email = 'verifyenvfix@example.com';

  console.log(`🗑️  Deleting test user: ${email}\n`);

  try {
    // 1. Find the user in auth.users
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('Error listing users:', listError);
      return;
    }

    const user = users.users.find(u => u.email === email);

    if (!user) {
      console.log('❌ User not found in auth.users');
      return;
    }

    const userId = user.id;
    console.log(`✅ Found user ID: ${userId}`);

    // 2. Delete from related tables (cascading should handle most, but let's be thorough)

    // Check user_profiles
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profile) {
      console.log('  📋 Found in user_profiles');
    }

    // Check vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', userId);

    if (vehicles && vehicles.length > 0) {
      console.log(`  🚗 Found ${vehicles.length} vehicle(s)`);
    }

    // Check renewal_charges (Option B table)
    const { data: charges } = await supabase
      .from('renewal_charges')
      .select('*')
      .eq('user_id', userId);

    if (charges && charges.length > 0) {
      console.log(`  💳 Found ${charges.length} renewal charge(s)`);
    }

    // 3. Delete the user (this will cascade to related tables due to ON DELETE CASCADE)
    console.log('\n🗑️  Deleting user from auth.users (this will cascade delete related records)...');

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('❌ Error deleting user:', deleteError);
      return;
    }

    console.log('✅ User deleted successfully!');
    console.log('\n✨ All records for verifyenvfix@example.com have been removed.');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

deleteTestUser();
