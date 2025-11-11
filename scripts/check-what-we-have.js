#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('🔍 Checking what we have...\n');

  // Check main table
  const { count, error } = await supabase
    .from('contested_tickets_foia')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Main table: ${count?.toLocaleString()} records`);

  // Check a sample
  const { data: sample } = await supabase
    .from('contested_tickets_foia')
    .select('*')
    .limit(3);

  console.log('\n📋 Sample records:');
  sample?.forEach(r => {
    console.log(`   - Ticket ${r.ticket_number}: ${r.violation_code} → ${r.disposition}`);
  });

  // Check dispositions
  const { data: dispositions } = await supabase
    .from('contested_tickets_foia')
    .select('disposition')
    .limit(10000);

  const counts = {};
  dispositions?.forEach(d => {
    counts[d.disposition] = (counts[d.disposition] || 0) + 1;
  });

  console.log('\n📊 Disposition breakdown (sample of 10k):');
  Object.entries(counts).forEach(([disp, count]) => {
    console.log(`   - ${disp}: ${count.toLocaleString()}`);
  });

  // Try to query a specific violation
  console.log('\n🔍 Testing violation code query...');
  const { data: violation, error: vErr } = await supabase
    .from('contested_tickets_foia')
    .select('*')
    .eq('violation_code', '0976160B')
    .limit(5);

  if (vErr) {
    console.log('❌ Error:', vErr.message);
  } else {
    console.log(`   Found ${violation?.length} records for violation 0976160B`);
    if (violation && violation.length > 0) {
      const wins = violation.filter(v => v.disposition === 'Not Liable').length;
      console.log(`   - ${wins} Not Liable, ${violation.length - wins} other`);
    }
  }
}

check().catch(console.error);
