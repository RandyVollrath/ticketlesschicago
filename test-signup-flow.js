const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSignupFlow() {
  const email = 'hiautopilotamerica+1@gmail.com';
  
  try {
    console.log('🧪 Testing signup flow for:', email);
    
    // Step 1: Try to create user (will fail since exists)
    console.log('\n1️⃣ Attempting to create user...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: {
        first_name: 'Test',
        last_name: 'User',
        phone: '5551234567'
      }
    });
    
    let userId = null;
    
    if (authError) {
      console.log('❌ Auth error:', authError.message);
      
      // Check if user exists
      if (authError.message?.includes('already') || authError.message?.includes('exists')) {
        console.log('✅ User already exists, finding existing user...');
        
        const { data: existingUser } = await supabase.auth.admin.listUsers();
        const user = existingUser?.users.find(u => u.email === email);
        
        if (user) {
          userId = user.id;
          console.log('✅ Found existing user:', userId);
          
          // Step 2: Check OAuth status
          console.log('\n2️⃣ Checking OAuth status...');
          const { data: userData } = await supabase.auth.admin.getUserById(userId);
          const hasOAuthProvider = userData?.user?.identities && userData.user.identities.length > 0;
          const oauthProvider = hasOAuthProvider ? userData.user.identities[0]?.provider : null;
          
          console.log('Has OAuth:', hasOAuthProvider);
          console.log('OAuth Provider:', oauthProvider || 'None');
          console.log('Identities:', userData?.user?.identities?.length || 0);
          
          // Step 3: Should email be sent?
          console.log('\n3️⃣ Email sending logic:');
          if (hasOAuthProvider) {
            console.log('⏭️  Would SKIP verification email - user authenticated via OAuth');
          } else {
            console.log('📧 Would SEND verification email - no OAuth provider found');
          }
        }
      }
    } else {
      userId = authData?.user?.id;
      console.log('✅ Created new user:', userId);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testSignupFlow();
