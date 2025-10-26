const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testCreate() {
  const email = 'totallynewemail999@gmail.com';
  
  console.log('Attempting to create user:', email);
  
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: {
      first_name: 'Test',
      last_name: 'User'
    }
  });
  
  if (error) {
    console.error('❌ Error:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  } else {
    console.log('✅ User created:', data.user.id);
  }
}

testCreate().catch(console.error);
