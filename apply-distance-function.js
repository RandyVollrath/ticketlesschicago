// Apply the calculate_distance_from_point function to MSC database
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const MSC_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_SERVICE_ROLE_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

if (!MSC_SERVICE_ROLE_KEY) {
  console.error('❌ MSC_SUPABASE_SERVICE_ROLE_KEY not set');
  console.log('Set it with: export MSC_SUPABASE_SERVICE_ROLE_KEY=your_key');
  process.exit(1);
}

const mscSupabase = createClient(MSC_URL, MSC_SERVICE_ROLE_KEY);

async function applyFunction() {
  console.log('📝 Reading SQL function...');
  const sql = fs.readFileSync('calculate_distance_from_point.sql', 'utf8');

  console.log('🔧 Applying function to MSC database...');

  try {
    const { data, error } = await mscSupabase.rpc('exec_sql', {
      sql_query: sql
    });

    if (error) {
      // Try direct approach if exec_sql doesn't exist
      console.log('⚠️ exec_sql not available, trying alternative approach...');

      // We need to apply this via the Supabase dashboard SQL editor
      console.log('\n📋 Please run the following SQL in the Supabase SQL editor:');
      console.log('\nURL: https://supabase.com/dashboard/project/zqljxkqdgfibfzdjfjiq/sql/new');
      console.log('\n' + sql);
      console.log('\nAfter running, the API will work correctly.');
      return;
    }

    console.log('✅ Function created successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.log('\n📋 Please run the following SQL in the Supabase SQL editor:');
    console.log('\nURL: https://supabase.com/dashboard/project/zqljxkqdgfibfzdjfjiq/sql/new');
    console.log('\n' + sql);
  }
}

applyFunction();
