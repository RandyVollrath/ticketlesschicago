const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const email = 'hellodolldarlings@gmail.com';
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === email);
  
  if (user) {
    console.log('❌ User still exists in auth.users');
    console.log('ID:', user.id);
    console.log('Created:', user.created_at);
  } else {
    console.log('✅ User does not exist');
  }
}

check().catch(console.error);
