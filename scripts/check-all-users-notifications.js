const { createClient } = require('@supabase/supabase-js');

const ticketlessSupabase = createClient(
  'https://dzhqolbhuqdcpngdayuq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aHFvbGJodXFkY3BuZ2RheXVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODkyMzM5OSwiZXhwIjoyMDc0NDk5Mzk5fQ.FgwEeRwuwr6EJCKfGD4P7eFu5TP4-UuC6baBpxWqK7U'
);

(async () => {
  console.log('🔍 COMPLETE NOTIFICATION SYSTEM CHECK\n');
  console.log('='.repeat(60));
  
  const { data: users, error } = await ticketlessSupabase
    .from('user_profiles')
    .select('email, city_sticker_expiry, license_plate_expiry, emissions_date, notification_preferences, phone_number')
    .not('city_sticker_expiry', 'is', null);
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  console.log(`\nFound ${users.length} users with renewal dates\n`);
  
  let withPrefs = 0;
  let withoutPrefs = 0;
  let withPhone = 0;
  let withoutPhone = 0;
  let smsEnabled = 0;
  let willNotifyTomorrow = 0;
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  console.log('📋 Users needing attention:\n');
  
  users.forEach(user => {
    const prefs = user.notification_preferences;
    const hasReminderDays = prefs && prefs.reminder_days && Array.isArray(prefs.reminder_days);
    const hasSMS = prefs && prefs.sms === true;
    
    if (hasReminderDays) withPrefs++;
    else withoutPrefs++;
    
    if (user.phone_number) withPhone++;
    else withoutPhone++;
    
    if (hasSMS && user.phone_number) smsEnabled++;
    
    // Check if they'll get notified tomorrow
    const reminderDays = (prefs && prefs.reminder_days) || [30, 7, 1];
    let userWillNotify = false;
    
    if (user.city_sticker_expiry) {
      const dueDate = new Date(user.city_sticker_expiry);
      dueDate.setUTCHours(0, 0, 0, 0);
      const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (reminderDays.includes(daysUntil) && hasSMS && user.phone_number) {
        userWillNotify = true;
        willNotifyTomorrow++;
      }
    }
    
    if (!hasReminderDays || !user.phone_number || !hasSMS) {
      console.log(`⚠️  ${user.email}:`);
      if (!hasReminderDays) console.log('   ❌ Missing reminder_days (will use default [30, 7, 1])');
      if (!user.phone_number) console.log('   ❌ Missing phone number');
      if (!hasSMS) console.log('   ❌ SMS not enabled');
      console.log('');
    }
  });
  
  console.log('='.repeat(60));
  console.log('\n📊 SYSTEM-WIDE SUMMARY:\n');
  console.log(`  Total users with renewals: ${users.length}`);
  console.log(`  With reminder_days set: ${withPrefs}`);
  console.log(`  Using defaults: ${withoutPrefs} (defaults to [30, 7, 1])`);
  console.log(`  With phone number: ${withPhone}`);
  console.log(`  Without phone: ${withoutPhone}`);
  console.log(`  SMS fully enabled: ${smsEnabled}`);
  console.log(`  Will notify tomorrow: ${willNotifyTomorrow}`);
  
  // Randy specific check
  const randy = users.find(u => u.email === 'randyvollrath@gmail.com');
  if (randy) {
    const citySticker = new Date(randy.city_sticker_expiry);
    citySticker.setUTCHours(0, 0, 0, 0);
    const daysUntil = Math.floor((citySticker.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    const prefs = randy.notification_preferences || {};
    const reminderDays = prefs.reminder_days || [30, 7, 1];
    
    console.log('\n='.repeat(60));
    console.log('\n📱 RANDY\'S NOTIFICATION STATUS:\n');
    console.log(`  Today (UTC): ${today.toISOString().split('T')[0]}`);
    console.log(`  City sticker expires: ${randy.city_sticker_expiry}`);
    console.log(`  Days until: ${daysUntil}`);
    console.log(`  Reminder days: [${reminderDays.join(', ')}]`);
    console.log(`  Will trigger: ${reminderDays.includes(daysUntil) ? '✅ YES' : '❌ NO'}`);
    console.log(`  Phone: ${randy.phone_number || '❌ NONE'}`);
    console.log(`  SMS enabled: ${prefs.sms ? '✅ YES' : '❌ NO'}`);
    console.log(`  Voice enabled: ${prefs.voice ? '✅ YES' : '❌ NO'}`);
    
    if (reminderDays.includes(daysUntil) && randy.phone_number && prefs.sms) {
      console.log('\n  🎉 RANDY WILL RECEIVE SMS NOTIFICATION TOMORROW AT 9AM CHICAGO TIME');
    }
  }
  
  console.log('\n' + '='.repeat(60));
})();
