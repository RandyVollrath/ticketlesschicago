const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  'https://zqljxkqdgfibfzdjfjiq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes'
);

async function checkEverything() {
  console.log('📊 CORRECTED DIAGNOSTIC CHECK\n');
  console.log('='.repeat(60));
  
  // Get proper Chicago time
  const now = new Date();
  const chicagoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const tomorrow = new Date(chicagoNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  console.log('\n⏰ TIMEZONE CHECK\n');
  console.log('   UTC Now:', now.toISOString());
  console.log('   Chicago Now:', chicagoNow.toLocaleString());
  console.log('   Chicago Today:', chicagoNow.toISOString().split('T')[0]);
  console.log('   Tomorrow:', tomorrowStr);
  
  // 1. Check Randy's FULL profile with ALL fields
  console.log('\n1️⃣  RANDY\'S COMPLETE PROFILE\n');
  
  const { data: profile, error: profileError } = await mscSupabase
    .from('user_profiles')
    .select('*')
    .eq('email', 'randyvollrath@gmail.com')
    .single();
  
  if (profileError) {
    console.error('❌ Error:', profileError.message);
    return;
  }
  
  if (!profile) {
    console.log('❌ No profile found');
    return;
  }
  
  console.log('✅ Profile found');
  console.log('\n📍 Street Cleaning:');
  console.log('   Address:', profile.home_address_full);
  console.log('   Ward:', profile.home_address_ward);
  console.log('   Section:', profile.home_address_section);
  console.log('   Notify Days:', profile.notify_days_array);
  console.log('   Evening Before:', profile.notify_evening_before);
  console.log('   Email:', profile.notify_email);
  console.log('   SMS:', profile.notify_sms);
  console.log('   Is Canary:', profile.is_canary);
  
  console.log('\n🚗 Vehicle Renewals:');
  console.log('   City Sticker Expiry:', profile.city_sticker_expiry);
  console.log('   License Plate Expiry:', profile.license_plate_expiry);
  console.log('   Emissions Date:', profile.emissions_date);
  console.log('   Reminder Days:', profile.reminder_days);
  
  // Print ALL fields to see what's actually there
  console.log('\n📋 ALL PROFILE FIELDS:');
  Object.keys(profile).sort().forEach(key => {
    if (profile[key] !== null && profile[key] !== undefined) {
      console.log(`   ${key}:`, JSON.stringify(profile[key]));
    }
  });
  
  // 2. Check tomorrow's cleaning with CORRECT date
  console.log('\n2️⃣  STREET CLEANING FOR ' + tomorrowStr + '\n');
  console.log('   Looking for Ward', profile.home_address_ward, 'Section', profile.home_address_section);
  
  const { data: cleaning, error: cleaningError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('street_name, side, cleaning_date')
    .eq('ward', profile.home_address_ward)
    .eq('section', profile.home_address_section)
    .eq('cleaning_date', tomorrowStr);
  
  if (cleaningError) {
    console.error('   ❌ Error:', cleaningError.message);
  } else if (cleaning && cleaning.length > 0) {
    console.log('   ✅ YES - Cleaning scheduled!');
    console.log('   Streets:', cleaning.length, 'segments');
    cleaning.slice(0, 5).forEach(c => {
      console.log('     -', c.cleaning_date, c.street_name, c.side);
    });
  } else {
    console.log('   ❌ NO cleaning scheduled');
  }
  
  // 3. Check what sections exist for Ward 43
  console.log('\n3️⃣  AVAILABLE SECTIONS IN WARD 43\n');
  
  const { data: sections, error: sectionsError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('section')
    .eq('ward', '43')
    .order('section');
  
  if (!sectionsError && sections) {
    const uniqueSections = [...new Set(sections.map(s => s.section))].sort();
    console.log('   Sections in MSC database:', uniqueSections.join(', '));
    
    if (uniqueSections.includes(profile.home_address_section)) {
      console.log('   ✅ Section', profile.home_address_section, 'EXISTS');
    } else {
      console.log('   ❌ Section', profile.home_address_section, 'NOT FOUND');
    }
  }
  
  console.log('\n' + '='.repeat(60));
}

checkEverything().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
