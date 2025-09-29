const { createClient } = require('@supabase/supabase-js');

async function investigateGreyZones() {
  console.log('🕵️ Investigating grey zones in detail...');
  
  const mscClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  // Get some sample grey zones and check their full cleaning history
  const { data: allZones } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null);

  const { data: futureSchedule } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .gte('cleaning_date', todayStr);
    
  // Find zones with no future cleaning
  const futureZones = new Set();
  futureSchedule?.forEach(item => {
    futureZones.add(`${item.ward}-${item.section}`);
  });
  
  const greyZones = [];
  const zoneMap = new Map();
  allZones?.forEach(zone => {
    const key = `${zone.ward}-${zone.section}`;
    if (!zoneMap.has(key)) {
      if (!futureZones.has(key)) {
        greyZones.push({ ward: zone.ward, section: zone.section });
      }
      zoneMap.set(key, zone);
    }
  });
  
  console.log('⚫ Found', greyZones.length, 'zones with no future cleaning');
  
  // Check the cleaning history for these zones
  console.log('\n🔍 Checking cleaning history for sample grey zones...');
  
  for (let i = 0; i < Math.min(5, greyZones.length); i++) {
    const zone = greyZones[i];
    console.log(`\n📍 Ward ${zone.ward}, Section ${zone.section}:`);
    
    // Get all cleaning dates for this zone (past and future)
    const { data: allCleanings } = await mscClient
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', zone.ward)
      .eq('section', zone.section)
      .order('cleaning_date', { ascending: false });
    
    if (allCleanings && allCleanings.length > 0) {
      console.log(`   📅 Total cleaning records: ${allCleanings.length}`);
      console.log(`   📅 Most recent cleaning: ${allCleanings[0].cleaning_date}`);
      console.log(`   📅 Oldest cleaning: ${allCleanings[allCleanings.length - 1].cleaning_date}`);
      
      // Check if most recent is in the past
      const mostRecent = new Date(allCleanings[0].cleaning_date);
      if (mostRecent < today) {
        console.log(`   ✅ Last cleaning was ${Math.ceil((today - mostRecent) / (1000 * 60 * 60 * 24))} days ago`);
        console.log('   💡 This zone likely finished its cleaning season');
      }
    } else {
      console.log('   ❌ No cleaning records found for this zone');
      console.log('   🚨 This might indicate missing data or non-cleaned area');
    }
  }
  
  // Check if there are zones that historically have very few cleanings
  console.log('\n📊 Analyzing cleaning frequency patterns...');
  
  const { data: allSchedules } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .order('ward, section, cleaning_date');
    
  const zoneCleaningCounts = {};
  allSchedules?.forEach(item => {
    const key = `${item.ward}-${item.section}`;
    zoneCleaningCounts[key] = (zoneCleaningCounts[key] || 0) + 1;
  });
  
  // Get stats on cleaning frequency
  const counts = Object.values(zoneCleaningCounts);
  const avgCleanings = counts.reduce((a, b) => a + b, 0) / counts.length;
  const minCleanings = Math.min(...counts);
  const maxCleanings = Math.max(...counts);
  
  console.log(`   📊 Average cleanings per zone: ${avgCleanings.toFixed(1)}`);
  console.log(`   📊 Min cleanings: ${minCleanings}, Max cleanings: ${maxCleanings}`);
  
  // Find zones with very few cleanings (possible data issues)
  const lowCleaningZones = Object.entries(zoneCleaningCounts)
    .filter(([_, count]) => count < 3)
    .slice(0, 10);
    
  if (lowCleaningZones.length > 0) {
    console.log('\n🚨 Zones with very few cleaning records (possible data issues):');
    lowCleaningZones.forEach(([zone, count]) => {
      const [ward, section] = zone.split('-');
      console.log(`   Ward ${ward}, Section ${section}: only ${count} cleaning records`);
    });
  }
  
  // Final assessment
  console.log('\n🎯 Assessment:');
  const greyPercentage = Math.round((greyZones.length / zoneMap.size) * 100);
  
  if (greyPercentage > 60) {
    console.log(`   🚨 ${greyPercentage}% grey zones is quite high`);
    console.log('   💡 Recommendations:');
    console.log('     - Verify street cleaning season end dates');
    console.log('     - Check for missing schedule data');
    console.log('     - Consider extending date range for "later" cleanings');
  } else {
    console.log(`   ✅ ${greyPercentage}% grey zones is reasonable for late September`);
    console.log('   📝 Many zones likely completed their 2025 cleaning season');
    console.log('   🔄 Normal for street cleaning to wind down in fall');
  }
}

investigateGreyZones().catch(console.error);