#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyReasonData() {
  console.log('🔍 Checking if we have REASON data in database...\n');

  // Get records with reasons
  const { data: withReasons } = await supabase
    .from('contested_tickets_foia')
    .select('ticket_number, violation_code, disposition, reason')
    .eq('violation_code', '0976160B')
    .eq('disposition', 'Not Liable')
    .not('reason', 'is', null)
    .limit(10);

  if (!withReasons || withReasons.length === 0) {
    console.log('❌ NO REASON DATA FOUND!');
    console.log('The reason field is NULL for all records.');
    return;
  }

  console.log('✅ YES! We have reason data. Sample records:\n');
  withReasons.forEach((r, i) => {
    console.log(`${i+1}. Ticket ${r.ticket_number}`);
    console.log(`   Disposition: ${r.disposition}`);
    console.log(`   Reason: ${r.reason}`);
    console.log('');
  });

  // Count how many have reasons
  const { count: totalNotLiable } = await supabase
    .from('contested_tickets_foia')
    .select('*', { count: 'exact', head: true })
    .eq('violation_code', '0976160B')
    .eq('disposition', 'Not Liable');

  const { count: withReason } = await supabase
    .from('contested_tickets_foia')
    .select('*', { count: 'exact', head: true })
    .eq('violation_code', '0976160B')
    .eq('disposition', 'Not Liable')
    .not('reason', 'is', null);

  console.log(`📊 Statistics for violation 0976160B:`);
  console.log(`   Total 'Not Liable' outcomes: ${totalNotLiable}`);
  console.log(`   Records WITH reason data: ${withReason}`);
  console.log(`   Records WITHOUT reason: ${totalNotLiable - withReason}`);
  console.log(`   Percentage with reason: ${((withReason/totalNotLiable)*100).toFixed(1)}%`);

  // Get breakdown of reasons
  const { data: allReasons } = await supabase
    .from('contested_tickets_foia')
    .select('reason')
    .eq('violation_code', '0976160B')
    .eq('disposition', 'Not Liable')
    .not('reason', 'is', null)
    .limit(20000);

  const reasonCounts = {};
  allReasons.forEach(r => {
    reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
  });

  console.log(`\n📋 Top dismissal reasons:`);
  Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([reason, count], i) => {
      console.log(`   ${i+1}. ${reason}: ${count} cases`);
    });
}

verifyReasonData().catch(console.error);
