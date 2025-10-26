const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const email = 'thechicagoapp@gmail.com';
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === email);
  
  console.log('User created at:', user?.created_at);
  console.log('Last sign in:', user?.last_sign_in_at);
}

check().catch(console.error);
