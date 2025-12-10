const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEST_EMAILS = [
  'heyliberalname@gmail.com',
  'hellodolldarlings@gmail.com',
  'thechicagoapp@gmail.com',
  'principleddating@gmail.com',
  'ticketlessamerica@gmail.com',
  'ticketlesschicago@gmail.com',
  'hellosexdollnow@gmail.com',
  'mystreetcleaning@gmail.com'
];

async function deleteTestUsers() {
  console.log('🗑️  Starting test user deletion...\n');

  for (const email of TEST_EMAILS) {
    console.log(`\n📧 Processing: ${email}`);

    try {
      // 1. Find user in auth
      const { data: users } = await supabase.auth.admin.listUsers();
      const user = users?.users.find(u => u.email === email);

      if (!user) {
        console.log(`  ⏭️  User not found in auth, skipping`);
        continue;
      }

      const userId = user.id;
      console.log(`  ✓ Found user ID: ${userId}`);

      // 2. Delete from vehicles table
      const { error: vehiclesError } = await supabase
        .from('vehicles')
        .delete()
        .eq('user_id', userId);

      if (vehiclesError) {
        console.log(`  ⚠️  Error deleting vehicles:`, vehiclesError.message);
      } else {
        console.log(`  ✓ Deleted vehicles`);
      }

      // 3. Delete from user_profiles table
      const { error: profileError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('user_id', userId);

      if (profileError) {
        console.log(`  ⚠️  Error deleting profile:`, profileError.message);
      } else {
        console.log(`  ✓ Deleted profile`);
      }

      // 4. Delete from users table
      const { error: usersError } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (usersError) {
        console.log(`  ⚠️  Error deleting from users table:`, usersError.message);
      } else {
        console.log(`  ✓ Deleted from users table`);
      }

      // 5. Delete from drip_campaign_status (if exists)
      const { error: dripError } = await supabase
        .from('drip_campaign_status')
        .delete()
        .eq('user_id', userId);

      if (dripError && !dripError.message.includes('does not exist')) {
        console.log(`  ⚠️  Error deleting drip campaign:`, dripError.message);
      } else {
        console.log(`  ✓ Deleted drip campaign status`);
      }

      // 6. Delete from pending_signup (if exists)
      const { error: pendingError } = await supabase
        .from('pending_signup')
        .delete()
        .eq('email', email);

      if (pendingError && !pendingError.message.includes('does not exist')) {
        console.log(`  ⚠️  Error deleting pending signup:`, pendingError.message);
      } else {
        console.log(`  ✓ Deleted pending signup`);
      }

      // 7. Delete from Supabase Auth (last step)
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);

      if (authError) {
        console.log(`  ❌ Error deleting auth user:`, authError.message);
      } else {
        console.log(`  ✓ Deleted from auth`);
      }

      console.log(`  ✅ FULLY DELETED: ${email}`);

    } catch (error) {
      console.error(`  ❌ Error processing ${email}:`, error.message);
    }
  }

  console.log('\n\n🎉 Test user deletion complete!');
  console.log('These emails can now be used for fresh signup testing.\n');
}

deleteTestUsers();
