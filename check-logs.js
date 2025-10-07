const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://auth.ticketlessamerica.com',
  'sb_secret_Wya9tEp8AN0FaIsvMquGuw_3Ef1AYY1'
);

(async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log('Checking street cleaning notifications sent today from TA...\n');

  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('notification_type', 'street_cleaning')
    .gte('sent_at', today.toISOString())
    .order('sent_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
  } else if (data.length === 0) {
    console.log('❌ No street cleaning notifications sent today from TA');
  } else {
    console.log(`✅ Found ${data.length} street cleaning notification(s):\n`);
    data.forEach(n => {
      console.log(`- User: ${n.user_id}`);
      console.log(`  Sent at: ${n.sent_at}`);
      console.log(`  Type: ${n.metadata?.type || 'unknown'}`);
      console.log(`  Channels: ${n.metadata?.channels?.join(', ') || 'unknown'}`);
      console.log(`  Ward/Section: ${n.ward}/${n.section}`);
      console.log('');
    });
  }

  // Also check user profile
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('email, phone_number, notify_email, notify_sms, phone_call_enabled, notify_days_array, home_address_ward, home_address_section')
    .eq('email', 'randyvollrath@gmail.com')
    .single();

  if (profileError) {
    console.error('Error fetching profile:', profileError);
  } else {
    console.log('Randy\'s profile settings:');
    console.log(JSON.stringify(profile, null, 2));
  }
})();
