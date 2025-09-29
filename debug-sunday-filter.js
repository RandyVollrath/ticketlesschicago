const { createClient } = require('@supabase/supabase-js');

const MSC_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes';

const mscSupabase = createClient(MSC_URL, MSC_KEY);

async function debugSundayFilter() {
  console.log('🔍 Debugging why Sunday filter is not working...');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  console.log('Today is:', todayStr);
  
  // Query Ward 43, Section 1 exactly like the API does
  const { data: rawScheduleEntries, error } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('cleaning_date')
    .eq('ward', '43')
    .eq('section', '1')
    .gte('cleaning_date', todayStr)
    .order('cleaning_date', { ascending: true })
    .limit(10); // Get more to allow filtering
    
  console.log('\n📊 Raw schedule entries from database:');
  if (rawScheduleEntries) {
    rawScheduleEntries.forEach((entry, index) => {
      const date = new Date(entry.cleaning_date);
      const dayOfWeek = date.getDay();
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      console.log(`  ${index + 1}. ${entry.cleaning_date} (${dayName}, day=${dayOfWeek})`);
      
      if (dayOfWeek === 0) {
        console.log('    🚨 THIS IS A SUNDAY - SHOULD BE FILTERED OUT');
      }
    });
  }
  
  // Apply the EXACT same filtering logic as the API
  console.log('\n🔧 Applying Sunday filter...');
  let scheduleEntries = null;
  
  if (!error && rawScheduleEntries) {
    scheduleEntries = rawScheduleEntries.filter(entry => {
      const date = new Date(entry.cleaning_date);
      const dayOfWeek = date.getDay(); // 0 = Sunday
      if (dayOfWeek === 0) {
        console.warn(`Filtering out invalid Sunday cleaning date: ${entry.cleaning_date} for Ward 43, Section 1`);
        return false;
      }
      return true;
    }).slice(0, 1); // Take only the first valid date
  }
  
  console.log('\n✅ Filtered schedule entries:');
  if (scheduleEntries && scheduleEntries.length > 0) {
    scheduleEntries.forEach((entry, index) => {
      const date = new Date(entry.cleaning_date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      console.log(`  ${index + 1}. ${entry.cleaning_date} (${dayName})`);
    });
    
    const nextCleaningDate = scheduleEntries[0].cleaning_date;
    console.log(`\n🎯 API should return: ${nextCleaningDate}`);
    
    // Verify this is not a Sunday
    const testDate = new Date(nextCleaningDate);
    if (testDate.getDay() === 0) {
      console.log('🚨 ERROR: Filter failed - still returning Sunday!');
    } else {
      console.log('✅ Filter worked - no Sunday date returned');
    }
  } else {
    console.log('  No valid dates found after filtering');
  }
  
  // Check what the production API returns vs what we expect
  console.log('\n🌐 Testing production API response...');
  try {
    const response = await fetch('https://ticketless-chicago-m5013wlns-randyvollraths-projects.vercel.app/api/find-section?address=1013%20W%20Webster');
    const data = await response.json();
    
    console.log('Production API returned:', data.nextCleaningDate);
    
    if (data.nextCleaningDate) {
      const apiDate = new Date(data.nextCleaningDate);
      const apiDayOfWeek = apiDate.getDay();
      const apiDayName = apiDate.toLocaleDateString('en-US', { weekday: 'long' });
      
      console.log(`API date: ${data.nextCleaningDate} (${apiDayName}, day=${apiDayOfWeek})`);
      
      if (apiDayOfWeek === 0) {
        console.log('🚨 PRODUCTION API IS STILL RETURNING SUNDAY - FILTER NOT WORKING!');
      } else {
        console.log('✅ Production API returned valid weekday');
      }
    }
  } catch (err) {
    console.log('❌ Error testing production API:', err.message);
  }
}

debugSundayFilter().catch(console.error);