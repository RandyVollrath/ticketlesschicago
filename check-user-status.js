const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  const email = 'thechicagoapp@gmail.com';
  
  // Get user from auth
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === email);
  
  if (!user) {
    console.log('❌ User not found');
    return;
  }
  
  console.log('✅ User exists:', user.id);
  console.log('Email confirmed:', user.email_confirmed_at);
  console.log('Created:', user.created_at);
  
  // Check profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();
    
  console.log('\nProfile:', profile ? '✅ exists' : '❌ missing');
  if (profile) {
    console.log('Has protection:', profile.has_protection);
    console.log('Email verified flag:', profile.email_verified);
  }
}

checkUser().catch(console.error);
