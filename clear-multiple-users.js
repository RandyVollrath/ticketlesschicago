const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearUsers() {
  const emails = [
    'hiautopilotamerica@gmail.com'
  ];

  for (const email of emails) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Clearing user: ${email}`);
    console.log('='.repeat(60) + '\n');

    // Get user from auth
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);

    if (!user) {
      console.log('❌ User not found in auth.users');
      continue;
    }

    console.log('✓ Found user:', user.id);
    console.log('Email:', user.email);
    console.log('Created:', user.created_at);

    // Check profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profile) {
      console.log('✓ Profile exists');
    }

    // Check vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', user.id);

    if (vehicles?.length) {
      console.log(`✓ Vehicles: ${vehicles.length}`);
      vehicles.forEach(v => console.log(`  - ${v.license_plate || 'no plate'}`));
    }

    // Check protection subscriptions
    const { data: protection } = await supabase
      .from('protection_subscriptions')
      .select('*')
      .eq('user_id', user.id);

    if (protection?.length) {
      console.log(`✓ Protection subscriptions: ${protection.length}`);
    }

    // Check user_profiles
    const { data: userProfiles } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id);

    if (userProfiles?.length) {
      console.log(`✓ User profiles: ${userProfiles.length}`);
    }

    // Check users table
    const { data: usersTable } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id);

    if (usersTable?.length) {
      console.log(`✓ Users table: ${usersTable.length}`);
    }

    // Delete user data
    console.log('\n--- Deleting user data ---');

    // Delete message_audit_log first (has FK to user_profiles)
    const { error: malError } = await supabase
      .from('message_audit_log')
      .delete()
      .eq('user_id', user.id);
    if (malError) console.error('Error deleting message_audit_log:', malError);
    else console.log('✓ Deleted message_audit_log');

    // Delete vehicles
    if (vehicles?.length) {
      const { error: vError } = await supabase
        .from('vehicles')
        .delete()
        .eq('user_id', user.id);
      if (vError) console.error('Error deleting vehicles:', vError);
      else console.log('✓ Deleted vehicles');
    }

    // Delete protection subscriptions
    if (protection?.length) {
      const { error: pError } = await supabase
        .from('protection_subscriptions')
        .delete()
        .eq('user_id', user.id);
      if (pError) console.error('Error deleting protection subscriptions:', pError);
      else console.log('✓ Deleted protection subscriptions');
    }

    // Delete user_profiles
    if (userProfiles?.length) {
      const { error: upError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('user_id', user.id);
      if (upError) console.error('Error deleting user_profiles:', upError);
      else console.log('✓ Deleted user_profiles');
    }

    // Delete from users table
    if (usersTable?.length) {
      const { error: uError } = await supabase
        .from('users')
        .delete()
        .eq('id', user.id);
      if (uError) console.error('Error deleting from users table:', uError);
      else console.log('✓ Deleted from users table');
    }

    // Delete profile
    if (profile) {
      const { error: profError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', user.id);
      if (profError) console.error('Error deleting profile:', profError);
      else console.log('✓ Deleted profile');
    }

    // Delete auth user (must be last)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('Error deleting user from auth:', deleteError);
    } else {
      console.log('✓ Deleted user from auth');
    }

    console.log('\n✅ User cleared successfully!');
  }

  console.log(`\n\n🎉 All ${emails.length} users cleared!`);
}

clearUsers().catch(console.error);
