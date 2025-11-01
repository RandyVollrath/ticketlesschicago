const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  try {
    // List all users
    const { data, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
      console.error('Error listing users:', error);
      return;
    }

    // Find users matching hiautopilotamerica
    const matchingUsers = data.users.filter(u => 
      u.email?.includes('hiautopilotamerica')
    );

    console.log(`Found ${matchingUsers.length} users matching 'hiautopilotamerica':`);
    
    for (const user of matchingUsers) {
      console.log('\n---');
      console.log('Email:', user.email);
      console.log('User ID:', user.id);
      console.log('Created:', user.created_at);
      console.log('Email confirmed:', user.email_confirmed_at ? 'Yes' : 'No');
      console.log('Identities:', user.identities?.map(i => i.provider).join(', ') || 'None');
      console.log('Has OAuth:', user.identities && user.identities.length > 0 ? 'Yes' : 'No');
    }
    
    if (matchingUsers.length === 0) {
      console.log('\nNo users found with hiautopilotamerica email');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUser();
