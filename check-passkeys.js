const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPasskeys() {
  const userId = '926ee150-2c47-4bcd-be14-4329cf81d1ae';
  
  try {
    console.log('🔐 Checking user_passkeys table...');
    
    const { data, error } = await supabase
      .from('user_passkeys')
      .select('*')
      .eq('user_id', userId);
    
    if (error) {
      console.error('❌ Error:', error.message);
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('❌ No passkeys found in user_passkeys table');
    } else {
      console.log('✅ Found', data.length, 'passkey(s):');
      data.forEach((pk, idx) => {
        console.log('\nPasskey', idx + 1 + ':');
        console.log('  ID:', pk.id);
        console.log('  Name:', pk.name);
        console.log('  Created:', pk.created_at);
        console.log('  Last used:', pk.last_used || 'Never');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkPasskeys();
