const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Specific emails to clean up
const EMAILS_TO_CLEANUP = [
  'hiautopilotamerica@gmail.com',
  'hiautopilotamerica+1@gmail.com',
  'mystreetcleaning@gmail.com',
  'hellodolldarlings@gmail.com',
  'hellosexdollnow@gmail.com',
  'principleddating@gmail.com',
  'thechicagoapp@gmail.com',
  'countluigivampa@gmail.com'
];

async function cleanupSpecificEmails() {
  console.log('🧹 Cleaning up specific email accounts...\n');

  try {
    // List all users
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('Error listing users:', listError);
      return;
    }

    // Find matching accounts
    const accountsToDelete = users.users.filter(user => {
      return EMAILS_TO_CLEANUP.some(email =>
        user.email?.toLowerCase() === email.toLowerCase()
      );
    });

    console.log(`📊 Checking ${EMAILS_TO_CLEANUP.length} emails...`);
    console.log(`🎯 Found ${accountsToDelete.length} accounts to delete:\n`);

    if (accountsToDelete.length === 0) {
      console.log('✅ None of these emails are currently in use!\n');
      console.log('All emails are available:');
      EMAILS_TO_CLEANUP.forEach(email => console.log(`  ✅ ${email}`));
      return;
    }

    // Show what will be deleted
    accountsToDelete.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (ID: ${user.id.substring(0, 8)}...)`);
    });

    // Also check for +alias variants
    console.log('\n🔍 Checking for +alias variants...');
    const baseEmails = EMAILS_TO_CLEANUP.map(email => email.split('@')[0].split('+')[0] + '@' + email.split('@')[1]);
    const aliasAccounts = users.users.filter(user => {
      return baseEmails.some(baseEmail => {
        const userBase = user.email?.split('@')[0].split('+')[0] + '@' + user.email?.split('@')[1];
        return userBase.toLowerCase() === baseEmail.toLowerCase();
      });
    });

    const additionalAliases = aliasAccounts.filter(user => {
      return !accountsToDelete.some(a => a.id === user.id);
    });

    if (additionalAliases.length > 0) {
      console.log(`Found ${additionalAliases.length} additional +alias accounts:\n`);
      additionalAliases.forEach((user, index) => {
        console.log(`${accountsToDelete.length + index + 1}. ${user.email} (ID: ${user.id.substring(0, 8)}...)`);
      });
      accountsToDelete.push(...additionalAliases);
    }

    console.log(`\n⚠️  ${accountsToDelete.length} account(s) will be PERMANENTLY DELETED.\n`);
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Delete each account
    let successCount = 0;
    let failCount = 0;

    for (const user of accountsToDelete) {
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
    console.log('\n✨ These emails are now available for fresh accounts!');
    console.log('\n💡 You can now use +1, +2, +3 aliases with any of these base emails:');
    EMAILS_TO_CLEANUP.forEach(email => {
      const base = email.split('+')[0];
      if (email.includes('@')) {
        console.log(`  - ${base}+1@${email.split('@')[1]}`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

cleanupSpecificEmails();
