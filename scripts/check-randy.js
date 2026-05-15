const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const MSC_URL = process.env.MSC_SUPABASE_URL;
const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
const AA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const AA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MSC_URL || !MSC_KEY || !AA_URL || !AA_KEY) {
  console.error('Missing Supabase credentials in .env.local (MSC_SUPABASE_URL, MSC_SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

const mscSupabase = createClient(MSC_URL, MSC_KEY);
const ticketlessSupabase = createClient(AA_URL, AA_KEY);

async function checkEverything() {
  console.log('📊 NOTIFICATION READINESS CHECK\n');
  console.log('=' .repeat(60));
  
  // 1. Check Randy's profile
  console.log('\n1️⃣  RANDY\'S PROFILE (MSC database)\n');
  
  const { data: profile, error: profileError } = await mscSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
  
  if (profileError) {
    console.error('❌ Profile Error:', profileError.message);
    return;
  }
  
  if (!profile) {
    console.log('❌ No profile found');
    return;
  }
  
  console.log('✅ Profile exists');
  console.log('   Address:', profile.home_address_full);
  console.log('   Ward:', profile.home_address_ward);
  console.log('   Section:', profile.home_address_section);
  console.log('   Notify Days:', profile.notify_days_array);
  console.log('   Evening Before:', profile.notify_evening_before);
  console.log('   Email:', profile.notify_email);
  console.log('   SMS:', profile.notify_sms);
  
  // 2. Check tomorrow's street cleaning
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  console.log('\n2️⃣  STREET CLEANING TOMORROW (' + tomorrowStr + ')\n');
  console.log('   Looking for Ward', profile.home_address_ward, 'Section', profile.home_address_section);
  
  const { data: cleaning, error: cleaningError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('street_name, side')
    .eq('ward', profile.home_address_ward)
    .eq('section', profile.home_address_section)
    .eq('cleaning_date', tomorrowStr);
  
  if (cleaningError) {
    console.error('   ❌ Error:', cleaningError.message);
  } else if (cleaning && cleaning.length > 0) {
    console.log('   ✅ YES - Cleaning IS scheduled!');
    console.log('   Streets:', cleaning.length, 'segments');
    console.log('   Examples:');
    cleaning.slice(0, 3).forEach(c => console.log('     -', c.street_name, c.side));
  } else {
    console.log('   ❌ NO - No cleaning scheduled');
  }
  
  // 3. Check vehicle renewals
  console.log('\n3️⃣  VEHICLE RENEWALS\n');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let willNotifyRenewal = false;
  
  if (profile.city_sticker_expiry) {
    const expiry = new Date(profile.city_sticker_expiry);
    const days = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
    const matches = profile.reminder_days && profile.reminder_days.includes(days);
    console.log('   City Sticker:', profile.city_sticker_expiry, '(' + days + ' days)');
    if (matches) {
      console.log('     ✅ WILL NOTIFY TOMORROW');
      willNotifyRenewal = true;
    }
  }
  
  if (profile.license_plate_expiry) {
    const expiry = new Date(profile.license_plate_expiry);
    const days = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
    const matches = profile.reminder_days && profile.reminder_days.includes(days);
    console.log('   License Plate:', profile.license_plate_expiry, '(' + days + ' days)');
    if (matches) {
      console.log('     ✅ WILL NOTIFY TOMORROW');
      willNotifyRenewal = true;
    }
  }
  
  if (profile.emissions_date) {
    const expiry = new Date(profile.emissions_date);
    const days = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
    const matches = profile.reminder_days && profile.reminder_days.includes(days);
    console.log('   Emissions:', profile.emissions_date, '(' + days + ' days)');
    if (matches) {
      console.log('     ✅ WILL NOTIFY TOMORROW');
      willNotifyRenewal = true;
    }
  }
  
  if (!profile.city_sticker_expiry && !profile.license_plate_expiry && !profile.emissions_date) {
    console.log('   ℹ️  No renewal dates set');
  } else if (!willNotifyRenewal) {
    console.log('   ❌ No renewals match reminder_days:', profile.reminder_days);
  }
  
  // 4. Check Ward 43, Section 1 in TicketlessAmerica
  console.log('\n4️⃣  WARD 43, SECTION 1 IN TICKETLESS AMERICA\n');
  
  const { data: ticketlessData, error: ticketlessError } = await ticketlessSupabase
    .from('street_cleaning_schedule')
    .select('cleaning_date')
    .eq('ward', '43')
    .eq('section', '1')
    .limit(5);
  
  if (ticketlessError) {
    console.error('   ❌ Error:', ticketlessError.message);
  } else if (ticketlessData && ticketlessData.length > 0) {
    console.log('   ✅ Exists in TicketlessAmerica');
    console.log('   Rows found:', ticketlessData.length);
  } else {
    console.log('   ❌ NOT FOUND in TicketlessAmerica');
    console.log('   This explains the "Invalid ward/section" error!');
  }
  
  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY\n');
  
  if (cleaning && cleaning.length > 0) {
    console.log('✅ Street cleaning notifications WILL fire tomorrow');
    console.log('   Cron schedule: 7pm tonight, 7am & 3pm tomorrow (Chicago)');
  } else {
    console.log('❌ No street cleaning tomorrow - no notification needed');
  }
  
  if (willNotifyRenewal) {
    console.log('✅ Renewal notifications WILL fire tomorrow at 9am UTC (4am Chicago)');
  } else {
    console.log('❌ No renewal notifications tomorrow (no dates match reminder_days)');
  }
  
  console.log('\n' + '='.repeat(60));
}

checkEverything().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
