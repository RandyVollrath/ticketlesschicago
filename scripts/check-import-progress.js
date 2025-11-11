#!/usr/bin/env node

/**
 * Check FOIA import progress
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkProgress() {
  // Get total count
  const { count, error } = await supabase
    .from('contested_tickets_foia')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log(`\n📊 Current Progress:`);
  console.log(`   Records imported: ${count?.toLocaleString() || 0}`);
  console.log(`   Target: 1,198,234`);

  if (count) {
    const percent = ((count / 1198234) * 100).toFixed(1);
    console.log(`   Progress: ${percent}%`);
    console.log(`   Remaining: ${(1198234 - count).toLocaleString()}\n`);

    // Estimate time remaining (assuming ~200 records/second)
    const remaining = 1198234 - count;
    const secondsRemaining = remaining / 200;
    const minutesRemaining = Math.ceil(secondsRemaining / 60);
    console.log(`   Estimated time remaining: ~${minutesRemaining} minutes\n`);
  }

  // Get sample of most recent imports
  const { data: recent } = await supabase
    .from('contested_tickets_foia')
    .select('ticket_number, violation_code, disposition, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  if (recent && recent.length > 0) {
    console.log(`📋 Most recent imports:`);
    recent.forEach(r => {
      console.log(`   - Ticket ${r.ticket_number} (${r.violation_code}): ${r.disposition}`);
    });
  }
}

checkProgress().then(() => process.exit(0)).catch(console.error);
