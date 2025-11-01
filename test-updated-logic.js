const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testUpdatedLogic() {
  const email = 'hiautopilotamerica+1@gmail.com';
  
  try {
    console.log('🧪 Testing UPDATED signup logic for:', email);
    
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const user = existingUser?.users.find(u => u.email === email);
    
    if (user) {
      const userId = user.id;
      console.log('✅ Found user:', userId);
      
      // NEW LOGIC: Filter out "email" provider
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      console.log('\n📋 All identities:', userData?.user?.identities?.map(i => i.provider).join(', '));
      
      const oauthIdentities = userData?.user?.identities?.filter(i => i.provider !== 'email') || [];
      const hasOAuthProvider = oauthIdentities.length > 0;
      const oauthProvider = hasOAuthProvider ? oauthIdentities[0]?.provider : null;
      
      console.log('\n🔍 After filtering out "email" provider:');
      console.log('OAuth Identities:', oauthIdentities.map(i => i.provider).join(', ') || 'None');
      console.log('Has OAuth Provider:', hasOAuthProvider);
      console.log('OAuth Provider:', oauthProvider || 'None');
      
      console.log('\n3️⃣ Email sending decision:');
      if (hasOAuthProvider) {
        console.log('⏭️  Would SKIP verification email - user authenticated via OAuth');
      } else {
        console.log('✅ Would SEND verification email - no OAuth provider found');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testUpdatedLogic();
