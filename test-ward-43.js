const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testWard43Section1() {
  console.log('🧪 Testing Ward 43, Section 1 specifically...');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  console.log('Today is:', todayStr);
  
  // Check if Ward 43, Section 1 has geometry data
  const { data: zoneWithGeometry } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .eq('ward', '43')
    .eq('section', '1')
    .not('geom_simplified', 'is', null)
    .limit(1);
    
  if (!zoneWithGeometry || zoneWithGeometry.length === 0) {
    console.log('❌ Ward 43, Section 1 has NO geometry data');
    
    // Check if it has any data at all
    const { data: anyData } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date, geom_simplified')
      .eq('ward', '43')
      .eq('section', '1')
      .limit(5);
      
    console.log('Any data for Ward 43, Section 1:', anyData?.length || 0, 'records');
    if (anyData && anyData.length > 0) {
      anyData.forEach(d => {
        console.log('  ', d.cleaning_date, 'geom:', d.geom_simplified ? 'YES' : 'NO');
      });
    }
    return;
  }
  
  console.log('✅ Ward 43, Section 1 HAS geometry data');
  
  // Get schedule data
  const { data: scheduleData } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .eq('ward', '43')
    .eq('section', '1')
    .gte('cleaning_date', todayStr)
    .order('cleaning_date', { ascending: true });
    
  console.log('Schedule data:', scheduleData?.length || 0, 'future cleanings');
  
  if (scheduleData && scheduleData.length > 0) {
    const nextCleaning = scheduleData[0];
    const cleaningDate = new Date(nextCleaning.cleaning_date);
    const diffTime = cleaningDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    console.log('Next cleaning:', nextCleaning.cleaning_date);
    console.log('Days from today:', diffDays);
    
    let status = 'unknown';
    if (diffDays === 0) status = 'today';
    else if (diffDays >= 1 && diffDays <= 3) status = 'soon';
    else status = 'later';
    
    console.log('Calculated status:', status);
    
    if (diffDays === 1) {
      console.log('🎯 This should show "Street cleaning in the next 3 days"');
    }
  }
}

testWard43Section1().catch(console.error);