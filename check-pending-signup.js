const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check(email) {
  console.log(`\n🔍 Checking pending_signups for: ${email}\n`);

  const { data, error } = await supabase
    .from('pending_signups')
    .select('*')
    .eq('email', email);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('❌ No pending signup found');
    console.log('\n📋 All pending signups:');
    const { data: all } = await supabase
      .from('pending_signups')
      .select('email, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (all && all.length > 0) {
      all.forEach(row => {
        console.log(`  - ${row.email} (${row.created_at})`);
      });
    } else {
      console.log('  (none)');
    }
  } else {
    console.log('✅ Found pending signup:');
    console.log(JSON.stringify(data[0], null, 2));
  }
}

check(process.argv[2] || 'countluigivampa@gmail.com');
