const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
  const userId = '926ee150-2c47-4bcd-be14-4329cf81d1ae';
  
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('All columns in user_profiles for this user:');
    console.log(JSON.stringify(data, null, 2));
    
    // Check specific fields
    console.log('\n📋 Key fields:');
    console.log('  phone_number:', data.phone_number);
    console.log('  license_plate:', data.license_plate);
    console.log('  email_verified:', data.email_verified);
    console.log('  phone_verified:', data.phone_verified);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkColumns();
