const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkEmail(email) {
  console.log(`🔍 Checking: ${email}\n`);

  try {
    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (user) {
      console.log('✅ Found account:');
      console.log(`   Email: ${user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Created: ${user.created_at}`);
      console.log(`   Providers: ${user.identities?.map(i => i.provider).join(', ') || 'email'}`);

      // Check if it has a profile
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profile) {
        console.log(`   Has profile: Yes`);
        console.log(`   License plate: ${profile.license_plate || 'none'}`);
        console.log(`   Has protection: ${profile.has_protection}`);
      } else {
        console.log(`   Has profile: No`);
      }
    } else {
      console.log('❌ Not found - email is AVAILABLE');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Check the base email
checkEmail('hiautopilotamerica@gmail.com');
