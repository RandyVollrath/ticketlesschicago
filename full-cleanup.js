const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupUser(email) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Cleaning: ${email}`);
  console.log('='.repeat(60));

  // Get user from auth
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found in auth.users');
    return;
  }

  console.log('✅ Found user:', user.id);

  // Delete from all tables
  const tables = [
    'vehicles',
    'protection_subscriptions', 
    'user_profiles',
    'users',
    'profiles'
  ];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq(table === 'profiles' ? 'id' : 'user_id', user.id);
    
    if (error && !error.message.includes('0 rows')) {
      console.log(`⚠️  ${table}:`, error.message);
    } else {
      console.log(`✓ Cleaned ${table}`);
    }
  }

  // Delete from auth.users (must be last)
  const { error: authError } = await supabase.auth.admin.deleteUser(user.id);
  if (authError) {
    console.error('❌ Failed to delete from auth:', authError);
  } else {
    console.log('✓ Deleted from auth.users');
  }
  
  console.log('✅ User cleaned completely');
}

async function cleanAll() {
  const emails = [
    'hellodolldarlings@gmail.com'
  ];

  for (const email of emails) {
    await cleanupUser(email);
  }

  console.log(`\n\n🎉 All ${emails.length} users cleaned!`);
}

cleanAll().catch(console.error);
