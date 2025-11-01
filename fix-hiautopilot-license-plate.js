const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixLicensePlate() {
  const userId = '926ee150-2c47-4bcd-be14-4329cf81d1ae';
  const licensePlate = 'CW22016';
  
  try {
    console.log('🔧 Updating user_profiles.license_plate to:', licensePlate);
    
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ license_plate: licensePlate })
      .eq('user_id', userId)
      .select();
    
    if (error) {
      console.error('❌ Error:', error);
    } else {
      console.log('✅ Updated successfully!');
      console.log('   License Plate:', data[0]?.license_plate);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixLicensePlate();
