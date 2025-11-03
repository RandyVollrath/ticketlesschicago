// Check if crons are actually running by examining recent database activity
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCronHealth() {
  console.log('🔍 CHECKING CRON JOB HEALTH\n');
  console.log('=' .repeat(60));

  // Check street cleaning notifications (should run 3x daily at 00:00, 12:00, 20:00 UTC)
  console.log('\n📍 STREET CLEANING CRON STATUS:');
  const { data: streetCleaningNotifs, error: sc_error } = await supabase
    .from('notifications')
    .select('created_at, notification_type, sent_at')
    .ilike('notification_type', '%street%')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (streetCleaningNotifs && streetCleaningNotifs.length > 0) {
    console.log(`✅ Found ${streetCleaningNotifs.length} street cleaning notifications in last 7 days`);
    console.log(`   Most recent: ${streetCleaningNotifs[0].created_at}`);

    // Group by date to see daily pattern
    const byDate = {};
    streetCleaningNotifs.forEach(n => {
      const date = n.created_at.split('T')[0];
      byDate[date] = (byDate[date] || 0) + 1;
    });
    console.log(`   Daily counts:`, byDate);
  } else {
    console.log(`❌ NO street cleaning notifications found in last 7 days!`);
    console.log(`   ERROR: Street cleaning cron may not be running!`);
  }

  // Check renewal notifications (should run daily at 09:00 UTC)
  console.log('\n🔔 RENEWAL NOTIFICATIONS CRON STATUS:');
  const { data: renewalNotifs, error: rn_error } = await supabase
    .from('notifications')
    .select('created_at, notification_type')
    .ilike('notification_type', '%renewal%')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (renewalNotifs && renewalNotifs.length > 0) {
    console.log(`✅ Found ${renewalNotifs.length} renewal notifications in last 7 days`);
    console.log(`   Most recent: ${renewalNotifs[0].created_at}`);
  } else {
    console.log(`⚠️  No renewal notifications in last 7 days (may be normal if no renewals due)`);
  }

  // Check general notifications (should run daily at 14:00 UTC / 2pm)
  console.log('\n📨 GENERAL NOTIFICATIONS CRON STATUS (2pm):');
  const { data: generalNotifs, error: gn_error } = await supabase
    .from('notifications')
    .select('created_at, notification_type')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  if (generalNotifs && generalNotifs.length > 0) {
    console.log(`✅ Found ${generalNotifs.length} total notifications in last 7 days`);
    const byDate = {};
    generalNotifs.forEach(n => {
      const date = n.created_at.split('T')[0];
      byDate[date] = (byDate[date] || 0) + 1;
    });
    console.log(`   Daily counts:`, byDate);
  }

  // Check towed vehicles table (sync cron should run every 15 min)
  console.log('\n🚗 TOW DATA SYNC CRON STATUS:');
  const { data: recentTows, error: tow_error } = await supabase
    .from('towed_vehicles')
    .select('created_at, plate')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (recentTows && recentTows.length > 0) {
    console.log(`✅ Found ${recentTows.length} tow records added in last 24 hours`);
    console.log(`   Most recent: ${recentTows[0].created_at} (Plate: ${recentTows[0].plate})`);
  } else {
    console.log(`❌ NO tow records added in last 24 hours!`);
    console.log(`   ERROR: Tow sync cron may not be running!`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY:');
  console.log('='.repeat(60));

  const criticalIssues = [];

  if (!streetCleaningNotifs || streetCleaningNotifs.length === 0) {
    criticalIssues.push('❌ CRITICAL: Street cleaning cron NOT running');
  }

  if (!recentTows || recentTows.length === 0) {
    criticalIssues.push('❌ WARNING: Tow sync cron NOT running');
  }

  if (criticalIssues.length > 0) {
    console.log('\n🚨 ISSUES DETECTED:\n');
    criticalIssues.forEach(issue => console.log(issue));
    console.log('\n💡 POSSIBLE CAUSE:');
    console.log('   Vercel plan may have cron job limit (Hobby=2, Pro=40)');
    console.log('   Current vercel.json has 20 cron jobs defined');
    console.log('   If on Hobby plan, only first 2 crons will run:');
    console.log('     1. /api/notifications/process (2pm)');
    console.log('     2. /api/admin/notify-renewals (9am)');
    console.log('   Street cleaning crons (positions 3-5) would NOT run!');
  } else {
    console.log('✅ All critical crons appear to be running');
  }
}

checkCronHealth().catch(console.error);
