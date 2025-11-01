const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: segments } = await supabase
    .from('sf_street_sweeping')
    .select('corridor, limits, full_name')
    .limit(10);

  console.log('Sample SF segments:');
  segments.forEach(s => {
    console.log(`\nCorridor: ${s.corridor}`);
    console.log(`Limits: ${s.limits}`);
    console.log(`Full name: ${s.full_name}`);
  });
}

check();
