const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCount() {
  const { count, error } = await supabase
    .from('sd_street_sweeping')
    .select('*', { count: 'exact', head: true });

  console.log('Total San Diego segments:', count);
}

checkCount();
