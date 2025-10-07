require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkUserByPhone(phone) {
  console.log(`\n🔍 Searching for user with phone: ${phone}\n`);

  // Search in user_profiles
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .or(`phone.eq.${phone},phone.eq.+1${phone}`)
    .order('created_at', { ascending: false });

  if (profileError) {
    console.error('Error searching profiles:', profileError);
  }

  if (!profiles || profiles.length === 0) {
    console.log('❌ No users found with that phone number');
    console.log('\nTrying alternative formats...');

    // Try with +1 prefix
    const { data: profiles2 } = await supabase
      .from('user_profiles')
      .select('*')
      .ilike('phone', `%${phone.slice(-10)}%`)
      .order('created_at', { ascending: false });

    if (profiles2 && profiles2.length > 0) {
      console.log('✅ Found users with similar phone numbers:');
      profiles2.forEach(p => {
        console.log(`\n  User ID: ${p.user_id}`);
        console.log(`  Email: ${p.email}`);
        console.log(`  Phone: ${p.phone}`);
        console.log(`  Street: ${p.street_address}`);
        console.log(`  Alerts enabled: ${p.alerts_enabled}`);
        console.log(`  Created: ${p.created_at}`);
      });
    } else {
      console.log('❌ No similar phone numbers found');
    }
    return;
  }

  console.log(`✅ Found ${profiles.length} user(s):\n`);

  for (const profile of profiles) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`User ID: ${profile.user_id}`);
    console.log(`Email: ${profile.email}`);
    console.log(`Phone: ${profile.phone}`);
    console.log(`Street Address: ${profile.street_address || 'Not set'}`);
    console.log(`Alerts Enabled: ${profile.alerts_enabled ? '✅ Yes' : '❌ No'}`);
    console.log(`Has Protection: ${profile.has_protection ? '✅ Yes' : '❌ No'}`);
    console.log(`Created: ${profile.created_at}`);

    // Check for alert schedule
    const { data: schedule } = await supabase
      .from('alert_schedules')
      .select('*')
      .eq('user_id', profile.user_id)
      .single();

    if (schedule) {
      console.log('\n📅 Alert Schedule:');
      console.log(`  Street: ${schedule.street}`);
      console.log(`  Ward: ${schedule.ward}`);
      console.log(`  Section: ${schedule.section}`);
      console.log(`  Next cleaning: ${schedule.next_cleaning_date || 'Unknown'}`);
    } else {
      console.log('\n⚠️  No alert schedule found');
    }

    // Check notification logs for Sept 30
    const { data: logs, error: logError } = await supabase
      .from('notification_logs')
      .select('*')
      .eq('user_id', profile.user_id)
      .gte('created_at', '2025-09-30T00:00:00Z')
      .lte('created_at', '2025-10-01T00:00:00Z')
      .order('created_at', { ascending: false });

    if (logs && logs.length > 0) {
      console.log('\n📨 Notifications on Sept 30:');
      logs.forEach(log => {
        console.log(`  - ${log.notification_type} via ${log.channel} at ${log.created_at}`);
        console.log(`    Status: ${log.status}`);
        if (log.error_message) console.log(`    Error: ${log.error_message}`);
      });
    } else {
      console.log('\n📭 No notifications sent on Sept 30, 2025');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

const phone = process.argv[2] || '3125354254';
checkUserByPhone(phone);
