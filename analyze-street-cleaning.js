const { createClient } = require('@supabase/supabase-js');

async function analyzeStreetCleaningData() {
  console.log('🔍 Analyzing street cleaning schedule data...');
  
  const mscClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Get today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  console.log('📅 Today:', todayStr);
  
  // Check total zones with geometry
  const { data: allZones } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null);
    
  console.log('📊 Total zone records with geometry:', allZones?.length || 0);
  
  // Check zones with future cleaning dates
  const { data: futureCleanings } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null)
    .gte('cleaning_date', todayStr);
    
  console.log('📅 Future cleaning records:', futureCleanings?.length || 0);
  
  // Get unique ward/section combinations for each
  const uniqueAllZones = new Set();
  allZones?.forEach(zone => {
    const key = zone.ward + '-' + zone.section;
    uniqueAllZones.add(key);
  });
  
  const uniqueFutureZones = new Set();
  futureCleanings?.forEach(zone => {
    const key = zone.ward + '-' + zone.section;
    uniqueFutureZones.add(key);
  });
  
  console.log('🗺️ Unique ward/section combinations total:', uniqueAllZones.size);
  console.log('📅 Unique ward/section with future cleaning:', uniqueFutureZones.size);
  console.log('⚫ Zones that would be grey (no future cleaning):', uniqueAllZones.size - uniqueFutureZones.size);
  
  if (uniqueAllZones.size > 0) {
    const greyPercentage = Math.round(((uniqueAllZones.size - uniqueFutureZones.size) / uniqueAllZones.size) * 100);
    console.log('📊 Percentage that would be grey:', greyPercentage + '%');
  }
  
  // Sample some zones that have no future cleaning
  const zonesWithoutFuture = Array.from(uniqueAllZones).filter(zone => !uniqueFutureZones.has(zone));
  console.log('\n🔍 Sample zones with no future cleaning (first 15):');
  zonesWithoutFuture.slice(0, 15).forEach(zone => {
    const parts = zone.split('-');
    console.log('  - Ward', parts[0], 'Section', parts[1]);
  });
  
  // Check date range of future cleanings
  if (futureCleanings && futureCleanings.length > 0) {
    const dates = futureCleanings.map(c => c.cleaning_date).sort();
    console.log('\n📅 Future cleaning date range:');
    console.log('   First:', dates[0]);
    console.log('   Last:', dates[dates.length - 1]);
    
    // Count by month
    const monthCounts = {};
    dates.forEach(date => {
      const month = date.substring(0, 7); // YYYY-MM
      monthCounts[month] = (monthCounts[month] || 0) + 1;
    });
    
    console.log('\n📊 Cleanings by month:');
    Object.entries(monthCounts).forEach(([month, count]) => {
      console.log('   ' + month + ':', count, 'cleanings');
    });
  }
  
  // Check if this is end of street cleaning season
  const currentMonth = today.getMonth() + 1; // 1-12
  if (currentMonth >= 10) {
    console.log('\n🍂 Late in street cleaning season (Oct-Dec)');
    console.log('   High percentage of grey zones may be normal');
  }
}

analyzeStreetCleaningData().catch(console.error);