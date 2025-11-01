const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { count, error } = await supabase
    .from('boston_street_sweeping')
    .select('*', { count: 'exact', head: true });

  console.log('Total segments:', count);

  const { count: geocoded } = await supabase
    .from('boston_street_sweeping')
    .select('*', { count: 'exact', head: true })
    .not('segment_lat', 'is', null);

  console.log('Geocoded segments:', geocoded);
  console.log('Remaining:', count - geocoded);
}

check();
