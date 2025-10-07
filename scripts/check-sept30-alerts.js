require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSept30Alerts() {
  console.log('🔍 Checking alerts sent on Tuesday, September 30, 2025\n');

  // Check notification logs
  const { data: logs, error } = await supabase
    .from('user_notifications')
    .select('*')
    .gte('created_at', '2025-09-30T00:00:00Z')
    .lt('created_at', '2025-10-01T00:00:00Z')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching logs:', error);
    return;
  }

  if (!logs || logs.length === 0) {
    console.log('❌ No notifications found for September 30, 2025');
    console.log('\nChecking if there were ANY alerts scheduled for that day...\n');

    // Check alert_schedules for that date
    const { data: schedules } = await supabase
      .from('alert_schedules')
      .select('*')
      .eq('next_cleaning_date', '2025-09-30');

    if (schedules && schedules.length > 0) {
      console.log(`⚠️  Found ${schedules.length} users scheduled for cleaning on Sept 30:`);
      schedules.forEach(s => {
        console.log(`  - User ${s.user_id}: ${s.street}, Ward ${s.ward}`);
      });
    } else {
      console.log('ℹ️  No street cleaning scheduled for September 30, 2025');
    }
    return;
  }

  console.log(`✅ Found ${logs.length} notifications sent on Sept 30:\n`);

  const smsLogs = logs.filter(l => l.channel === 'sms');
  const emailLogs = logs.filter(l => l.channel === 'email');

  console.log(`📱 SMS: ${smsLogs.length}`);
  console.log(`📧 Email: ${emailLogs.length}\n`);

  // Show details
  logs.forEach(log => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Time: ${log.created_at}`);
    console.log(`Type: ${log.notification_type}`);
    console.log(`Channel: ${log.channel}`);
    console.log(`Status: ${log.status}`);
    console.log(`User ID: ${log.user_id}`);
    if (log.recipient) console.log(`Recipient: ${log.recipient}`);
    if (log.message_content) console.log(`Message: ${log.message_content.substring(0, 100)}...`);
    if (log.error_message) console.log(`Error: ${log.error_message}`);
  });
}

checkSept30Alerts();
