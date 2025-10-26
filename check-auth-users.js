const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAll() {
  const { data: { users } } = await supabase.auth.admin.listUsers();
  
  const testEmails = [
    'hellosexdollnow@gmail.com',
    'thechicagoapp@gmail.com', 
    'hellodolldarlings@gmail.com',
    'testuser123@example.com'
  ];
  
  console.log('Checking auth.users for test accounts:\n');
  
  testEmails.forEach(email => {
    const user = users?.find(u => u.email === email);
    if (user) {
      console.log(`✓ ${email}: EXISTS (${user.id})`);
    } else {
      console.log(`✗ ${email}: not found`);
    }
  });
  
  console.log(`\nTotal users in auth: ${users.length}`);
}

checkAll().catch(console.error);
