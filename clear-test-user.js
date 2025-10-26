const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearUser() {
  const emails = [
    'thechicagoapp@gmail.com',
    'countluigivampa@gmail.com',
    'mystreetcleaning@gmail.com'
  ];

  for (const email of emails) {
    console.log(`\n${'='.repeat(60)}\nClearing user: ${email}\n${'='.repeat(60)}\n`);

  console.log(`Looking for user: ${email}`);
  }

  // Get user from auth
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === email);

  if (!user) {
    console.log('User not found in auth.users');
    return;
  }

  console.log('\n✓ Found user:', user.id);
  console.log('Email:', user.email);
  console.log('Created:', user.created_at);

  // Check profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile) {
    console.log('\n✓ Profile exists');
    console.log('Phone:', profile.phone);
    console.log('Has Protection:', profile.has_protection);
  }

  // Check vehicles
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', user.id);

  if (vehicles?.length) {
    console.log(`\n✓ Vehicles: ${vehicles.length}`);
    vehicles.forEach(v => console.log(`  - ${v.license_plate || 'no plate'}`));
  }

  // Check protection subscriptions
  const { data: protection } = await supabase
    .from('protection_subscriptions')
    .select('*')
    .eq('user_id', user.id);

  if (protection?.length) {
    console.log(`\n✓ Protection subscriptions: ${protection.length}`);
    protection.forEach(p => console.log(`  - Status: ${p.status}, Stripe: ${p.stripe_subscription_id}`));
  }

  // Delete user data
  console.log('\n--- Deleting user data ---');

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

  // Delete profile
  if (profile) {
    const { error: profError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id);
    if (profError) console.error('Error deleting profile:', profError);
    else console.log('✓ Deleted profile');
  }

  // Delete auth user
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('Error deleting user from auth:', deleteError);
  } else {
    console.log('✓ Deleted user from auth');
  }

  console.log('\n✅ User cleared successfully!');
  }
}

clearUser().catch(console.error);
