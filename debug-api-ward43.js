const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugAPILogic() {
  console.log('🔍 Debugging API logic that matches production...');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  console.log('Using date:', todayStr);
  
  // Step 1: Get ALL zones with geometry (like the API does)
  const { data: allZones, error: allZonesError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null);
    
  console.log('Total zones with geometry:', allZones?.length || 0);
  
  // Check if Ward 43, Section 1 is in this list
  const ward43section1 = allZones?.find(z => z.ward === '43' && z.section === '1');
  console.log('Ward 43, Section 1 in allZones?', ward43section1 ? 'YES' : 'NO');
  
  // Step 2: Get future cleaning schedules (like the API does)
  const { data: scheduleData } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .not('ward', 'is', null)
    .not('section', 'is', null)
    .gte('cleaning_date', todayStr)
    .order('cleaning_date', { ascending: true });
    
  console.log('Total future cleanings:', scheduleData?.length || 0);
  
  // Check if Ward 43, Section 1 is in the schedule
  const ward43section1Schedule = scheduleData?.filter(s => s.ward === '43' && s.section === '1');
  console.log('Ward 43, Section 1 future cleanings:', ward43section1Schedule?.length || 0);
  if (ward43section1Schedule?.length > 0) {
    console.log('Next cleaning:', ward43section1Schedule[0].cleaning_date);
  }
  
  // Step 3: Create the same schedule map logic
  const scheduleMap = new Map();
  scheduleData?.forEach(item => {
    const zoneKey = `${item.ward}-${item.section}`;
    if (!scheduleMap.has(zoneKey)) {
      scheduleMap.set(zoneKey, item.cleaning_date);
    }
  });
  
  console.log('Ward 43-1 in schedule map?', scheduleMap.has('43-1') ? 'YES' : 'NO');
  if (scheduleMap.has('43-1')) {
    console.log('Ward 43-1 next cleaning:', scheduleMap.get('43-1'));
  }
  
  // Step 4: Process zones exactly like the API does
  const zoneMap = new Map();
  allZones?.forEach(zone => {
    const zoneKey = `${zone.ward}-${zone.section}`;
    if (!zoneMap.has(zoneKey)) {
      let cleaningStatus = 'none';
      let nextCleaningDateISO = null;
      
      // Check if this zone has upcoming cleaning
      if (scheduleMap.has(zoneKey)) {
        const cleaningDate = new Date(scheduleMap.get(zoneKey));
        const diffTime = cleaningDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) cleaningStatus = 'today';
        else if (diffDays >= 1 && diffDays <= 3) cleaningStatus = 'soon';
        else cleaningStatus = 'later';
        
        nextCleaningDateISO = scheduleMap.get(zoneKey);
      }
      
      zoneMap.set(zoneKey, {
        ward: zone.ward,
        section: zone.section,
        geom_simplified: zone.geom_simplified,
        cleaningStatus,
        nextCleaningDateISO
      });
    }
  });
  
  // Check final result for Ward 43, Section 1
  const finalWard43Section1 = zoneMap.get('43-1');
  console.log('\nFinal result for Ward 43, Section 1:', finalWard43Section1 ? 'FOUND' : 'NOT FOUND');
  if (finalWard43Section1) {
    console.log('Status:', finalWard43Section1.cleaningStatus);
    console.log('Next cleaning:', finalWard43Section1.nextCleaningDateISO);
  }
  
  console.log('\nTotal zones in final result:', zoneMap.size);
}

debugAPILogic().catch(console.error);