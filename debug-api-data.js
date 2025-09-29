const { createClient } = require('@supabase/supabase-js');

async function debugAPIData() {
  console.log('🔧 Debugging API data processing...');
  
  const mscClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  console.log('📅 Today:', todayStr);
  
  // Simulate exactly what our API does
  
  // Step 1: Get ALL zones with geometry (what API now does)
  console.log('\n1️⃣ Getting ALL zones with geometry...');
  const { data: allZones, error: allZonesError } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null);

  if (allZonesError) {
    console.error('❌ Error loading all zones:', allZonesError);
    return;
  }

  console.log('📊 Total zone records:', allZones?.length || 0);

  // Step 2: Get future cleaning schedules
  console.log('\n2️⃣ Getting future cleaning schedules...');
  const { data: scheduleData, error } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .not('ward', 'is', null)
    .not('section', 'is', null)
    .gte('cleaning_date', todayStr)
    .order('cleaning_date', { ascending: true });

  if (error) {
    console.error('❌ Error loading schedule data:', error);
    return;
  }

  console.log('📅 Future cleaning records:', scheduleData?.length || 0);

  // Step 3: Process data exactly like API
  console.log('\n3️⃣ Processing data like API...');
  
  // Create schedule lookup map
  const scheduleMap = new Map();
  scheduleData?.forEach(item => {
    const zoneKey = `${item.ward}-${item.section}`;
    if (!scheduleMap.has(zoneKey)) {
      scheduleMap.set(zoneKey, item.cleaning_date);
    }
  });

  console.log('📋 Schedule map size:', scheduleMap.size);

  // Process all zones and assign status
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

  const processedData = Array.from(zoneMap.values());
  
  // Count by status
  const statusCounts = processedData.reduce((acc, zone) => {
    acc[zone.cleaningStatus] = (acc[zone.cleaningStatus] || 0) + 1;
    return acc;
  }, {});
  
  console.log('\n📊 Final results (what API returns):');
  console.log('   Total zones processed:', processedData.length);
  console.log('   Status distribution:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    const percentage = Math.round((count / processedData.length) * 100);
    const color = {
      'today': '🔴',
      'soon': '🟡', 
      'later': '🟢',
      'none': '⚫'
    }[status] || '❓';
    console.log(`     ${color} ${status}: ${count} zones (${percentage}%)`);
  });
  
  // Check if high grey percentage is reasonable
  const greyPercentage = Math.round(((statusCounts.none || 0) / processedData.length) * 100);
  console.log('\n🤔 Analysis:');
  if (greyPercentage > 50) {
    console.log(`   ${greyPercentage}% grey zones seems high for street cleaning season`);
    console.log('   🔍 Possible causes:');
    console.log('     - Street cleaning season ending (Oct-Nov)');
    console.log('     - Some zones may not have regular cleaning schedules');
    console.log('     - Missing schedule data for certain areas');
  } else {
    console.log(`   ${greyPercentage}% grey zones seems reasonable`);
  }
  
  // Sample some grey zones for manual verification
  const greyZones = processedData.filter(z => z.cleaningStatus === 'none');
  console.log('\n🔍 Sample zones with no future cleaning:');
  greyZones.slice(0, 10).forEach(zone => {
    console.log(`   Ward ${zone.ward}, Section ${zone.section}`);
  });
}

debugAPIData().catch(console.error);