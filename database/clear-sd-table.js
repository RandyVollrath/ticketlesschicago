const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function clearTable() {
  console.log('Deleting all records from sd_street_sweeping...');

  // Delete in batches
  let deleted = 0;
  while (true) {
    const { data, error } = await supabase
      .from('sd_street_sweeping')
      .delete()
      .limit(1000);

    if (error) {
      console.error('Error:', error);
      break;
    }

    const { count } = await supabase
      .from('sd_street_sweeping')
      .select('*', { count: 'exact', head: true });

    console.log(`Remaining: ${count}`);

    if (count === 0) break;
  }

  console.log('✅ Table cleared');
}

clearTable();
