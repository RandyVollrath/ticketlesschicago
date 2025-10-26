const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Common test email patterns
const TEST_EMAIL_PATTERNS = [
  'randyvollrath+',        // All +alias emails
  '@example.com',          // Test domain
  'test@',                 // Test emails
  'verifyenvfix@',         // Previous test account
];

async function cleanupTestEmails() {
  console.log('🧹 Cleaning up test email accounts...\n');

  try {
    // 1. List all users
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('Error listing users:', listError);
      return;
    }

    console.log(`📊 Found ${users.users.length} total users in auth system\n`);

    // 2. Filter test accounts
    const testAccounts = users.users.filter(user => {
      return TEST_EMAIL_PATTERNS.some(pattern => user.email?.includes(pattern));
    });

    console.log(`🎯 Found ${testAccounts.length} test accounts:\n`);

    if (testAccounts.length === 0) {
      console.log('✅ No test accounts to clean up!');
      return;
    }

    // 3. Show what will be deleted
    testAccounts.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (ID: ${user.id.substring(0, 8)}...)`);
    });

    console.log('\n⚠️  These accounts will be PERMANENTLY DELETED.\n');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. Delete each test account
    let successCount = 0;
    let failCount = 0;

    for (const user of testAccounts) {
      try {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);

        if (deleteError) {
          console.error(`❌ Failed to delete ${user.email}:`, deleteError.message);
          failCount++;
        } else {
          console.log(`✅ Deleted ${user.email}`);
          successCount++;
        }
      } catch (error) {
        console.error(`❌ Error deleting ${user.email}:`, error);
        failCount++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Successfully deleted: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('\n✨ Test emails are now available for reuse!');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

cleanupTestEmails();
