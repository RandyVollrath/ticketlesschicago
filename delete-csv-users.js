const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const csv = require('csv-parse/sync');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://auth.autopilotamerica.com';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function deleteUser(userId, email) {
  console.log(`\n🗑️  Deleting user: ${email} (${userId})`);

  try {
    // Delete from auth.users
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
      console.error(`   ❌ Failed to delete from auth: ${authError.message}`);
      return false;
    }
    console.log('   ✅ Deleted from auth.users');

    // Delete from user_profiles (cascade should handle related data)
    const { error: profileError } = await supabase
      .from('user_profiles')
      .delete()
      .eq('user_id', userId);

    if (profileError) {
      console.error(`   ❌ Failed to delete from user_profiles: ${profileError.message}`);
      return false;
    }
    console.log('   ✅ Deleted from user_profiles (and cascaded data)');

    return true;
  } catch (error) {
    console.error(`   ❌ Unexpected error: ${error.message}`);
    return false;
  }
}

async function main() {
  const csvPath = '/home/randy-vollrath/Downloads/user_profiles_rows-9.csv';
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = csv.parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  });

  console.log(`📋 Found ${records.length} users to delete\n`);

  let successCount = 0;
  let failCount = 0;

  for (const record of records) {
    const success = await deleteUser(record.user_id, record.email);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log(`\n✅ Successfully deleted: ${successCount}`);
  console.log(`❌ Failed to delete: ${failCount}`);
}

main().catch(console.error);
