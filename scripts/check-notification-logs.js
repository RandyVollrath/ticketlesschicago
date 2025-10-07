#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkNotificationLogs() {
  const phone = '13125354254';

  console.log('Checking for notification/message logs...\n');

  // Try to find any tables that might log notifications
  const tablesToCheck = [
    'notification_logs',
    'sms_logs',
    'sent_messages',
    'notifications',
    'messages'
  ];

  for (const table of tablesToCheck) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .or(`phone.eq.${phone},phone_number.eq.${phone},to_phone.eq.${phone},recipient.eq.${phone}`)
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && data && data.length > 0) {
        console.log(`\n✅ Found ${data.length} records in ${table}:`);
        console.log(JSON.stringify(data, null, 2));
      } else if (!error) {
        console.log(`Table ${table} exists but no records found for this phone`);
      }
    } catch (err) {
      // Table doesn't exist
    }
  }

  // Check if there's a way to see recent cron job executions
  console.log('\n\nChecking for cron execution logs...');

  try {
    const { data, error } = await supabase
      .from('cron_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!error && data) {
      console.log('Recent cron logs:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.log('No cron_logs table found');
  }
}

checkNotificationLogs().catch(console.error);
