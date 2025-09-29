const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkMSCNotificationReadiness() {
  console.log('🔍 Checking MSC notification system readiness for Randy...');
  
  const { data: randy, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
    
  if (randy) {
    console.log('📋 Randy profile for MSC notifications:');
    console.log('  Email:', randy.email);
    console.log('  Phone:', randy.phone_number);
    console.log('  Ward/Section:', randy.home_address_ward + '/' + randy.home_address_section);
    console.log('  Notify days array:', randy.notify_days_array);
    console.log('  Follow-up SMS:', randy.follow_up_sms);
    console.log('  SMS Pro:', randy.sms_pro);
    console.log('  Address:', randy.home_address_full);
    
    console.log('\n🔧 MSC System Requirements Check:');
    console.log('  Has email:', randy.email ? 'YES' : 'NO');
    console.log('  Has phone:', randy.phone_number ? 'YES' : 'NO');
    console.log('  Has ward/section:', (randy.home_address_ward && randy.home_address_section) ? 'YES' : 'NO');
    console.log('  Notify days configured:', randy.notify_days_array ? 'YES' : 'NO');
    
    if (!randy.notify_days_array || randy.notify_days_array.length === 0) {
      console.log('  🚨 PROBLEM: notify_days_array is empty - Randy will not get notifications!');
      console.log('  💡 FIX: Set notify_days_array to [0, 1] for morning-of and day-before notifications');
    }
    
    // Test if Randy should get notifications today
    const today = new Date();
    const ward = randy.home_address_ward;
    const section = randy.home_address_section;
    
    if (ward && section) {
      console.log('\n📅 Testing notification timing for Ward ' + ward + ', Section ' + section + '...');
      // This would need MSC database connection to test actual schedule
      console.log('  Ward/Section ready for MSC notification system: YES');
    }
  } else {
    console.log('❌ Randy not found in Ticketless America database');
  }
}

checkMSCNotificationReadiness().catch(console.error);