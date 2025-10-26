#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyWithSQL() {
  console.log('🔍 Checking tables directly via SQL query...\n');

  // Query PostgreSQL directly to see if table exists
  const query = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
      'court_case_outcomes',
      'win_rate_statistics',
      'attorneys',
      'attorney_case_expertise',
      'attorney_reviews',
      'attorney_quote_requests',
      'ticket_contests'
    )
    ORDER BY table_name;
  `;

  const { data, error } = await supabase.rpc('exec_sql', { query });

  if (error) {
    console.log('❌ Cannot query with exec_sql. Let me try another way...\n');

    // Try raw SQL query
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      console.log('⚠️  Cannot verify directly. Please check manually:\n');
      console.log('1. Go to Supabase Dashboard → Database → Tables');
      console.log('2. Look for: court_case_outcomes, attorneys, etc.');
      console.log('3. If you see them, click the 🔄 refresh icon');
      console.log('4. If you don\'t see them, the SQL didn\'t actually create them\n');
      return;
    }

    const result = await response.json();
    console.log('Result:', result);
  } else {
    console.log('✅ Found tables:', data);
  }
}

verifyWithSQL().catch(console.error);
