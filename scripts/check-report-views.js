#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkReportViews() {
  console.log('Checking report views for multi-day reminders...\n');

  const viewsToCheck = [
    'report_zero_day',
    'report_one_day',
    'report_two_day',
    'report_three_day',
    'report_follow_up'
  ];

  for (const view of viewsToCheck) {
    try {
      const { data, error } = await supabase
        .from(view)
        .select('email, home_address_ward, home_address_section')
        .limit(3);

      if (error) {
        console.log(`❌ ${view}: Does not exist or error - ${error.message}`);
      } else {
        console.log(`✅ ${view}: Exists with ${data?.length || 0} records (sample)`);
      }
    } catch (err) {
      console.log(`❌ ${view}: Error - ${err.message}`);
    }
  }
}

checkReportViews().catch(console.error);
