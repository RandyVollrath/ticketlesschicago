const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.vercel.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setProtection() {
  console.log('Setting has_protection=true for randyvollrath@gmail.com...');

  const { data, error } = await supabase
    .from('user_profiles')
    .update({ has_protection: true })
    .eq('email', 'randyvollrath@gmail.com')
    .select();

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('✅ Success! Updated user:', data);
}

setProtection();
