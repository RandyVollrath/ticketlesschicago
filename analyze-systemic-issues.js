const { createClient } = require('@supabase/supabase-js');

async function analyzeSystemicIssues() {
  console.log('🔍 SYSTEMATIC ANALYSIS: Street Cleaning Data Architecture Issues');
  console.log('='.repeat(70));
  
  const mscClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const ticketlessClient = createClient(
    process.env.TICKETLESS_SUPABASE_URL,
    process.env.TICKETLESS_SERVICE_ROLE_KEY
  );

  // 1. Analyze data integrity issues
  console.log('\n📊 1. DATA INTEGRITY ANALYSIS');
  console.log('-'.repeat(40));
  
  const today = new Date().toISOString().split('T')[0];
  
  // Check total zones vs zones with geometry
  const { data: allMSCRecords, count: totalCount } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section', { count: 'exact', head: true });
    
  const { data: zonesWithGeometry, count: geomCount } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section', { count: 'exact', head: true })
    .not('geom_simplified', 'is', null);
    
  const { data: futureCleanings, count: futureCount } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section', { count: 'exact', head: true })
    .gte('cleaning_date', today);
    
  console.log('MSC Database Stats:');
  console.log('  Total records:', totalCount || 'unknown');
  console.log('  Records with geometry:', geomCount || 'unknown');
  console.log('  Future cleaning records:', futureCount || 'unknown');
  
  // 2. Analyze API processing pipeline
  console.log('\n🔧 2. API PROCESSING PIPELINE ANALYSIS');
  console.log('-'.repeat(40));
  
  // Simulate the main API logic
  const { data: allZones } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null);
    
  const { data: scheduleData } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .not('ward', 'is', null)
    .not('section', 'is', null)
    .gte('cleaning_date', today)
    .order('cleaning_date', { ascending: true });
    
  console.log('API Query Results:');
  console.log('  Zones with geometry:', allZones?.length || 0);
  console.log('  Future schedule records:', scheduleData?.length || 0);
  
  // Dedupe analysis
  const uniqueZones = new Set();
  allZones?.forEach(zone => {
    uniqueZones.add(zone.ward + '-' + zone.section);
  });
  
  const uniqueSchedules = new Set();
  scheduleData?.forEach(item => {
    uniqueSchedules.add(item.ward + '-' + item.section);
  });
  
  console.log('  Unique zones with geometry:', uniqueZones.size);
  console.log('  Unique zones with future cleaning:', uniqueSchedules.size);
  console.log('  Zones that would appear grey:', uniqueZones.size - uniqueSchedules.size);
  
  // 3. Check for data loss in processing
  console.log('\n⚠️  3. DATA LOSS ANALYSIS');
  console.log('-'.repeat(40));
  
  const scheduleMap = new Map();
  scheduleData?.forEach(item => {
    const zoneKey = item.ward + '-' + item.section;
    if (!scheduleMap.has(zoneKey)) {
      scheduleMap.set(zoneKey, item.cleaning_date);
    }
  });
  
  const zoneMap = new Map();
  allZones?.forEach(zone => {
    const zoneKey = zone.ward + '-' + zone.section;
    if (!zoneMap.has(zoneKey)) {
      zoneMap.set(zoneKey, {
        ward: zone.ward,
        section: zone.section,
        hasSchedule: scheduleMap.has(zoneKey)
      });
    }
  });
  
  const finalProcessed = Array.from(zoneMap.values());
  const zonesWithoutSchedule = finalProcessed.filter(z => !z.hasSchedule);
  
  console.log('Processing Results:');
  console.log('  Final processed zones:', finalProcessed.length);
  console.log('  Zones without future cleaning:', zonesWithoutSchedule.length);
  console.log('  Data loss percentage:', Math.round((zonesWithoutSchedule.length / finalProcessed.length) * 100) + '%');
  
  // Sample problematic zones
  console.log('\nSample zones missing future cleaning:');
  zonesWithoutSchedule.slice(0, 10).forEach(zone => {
    console.log('    Ward ' + zone.ward + ', Section ' + zone.section);
  });
  
  // 4. Cross-database integration issues
  console.log('\n🔗 4. CROSS-DATABASE INTEGRATION ISSUES');
  console.log('-'.repeat(40));
  
  const { data: ticketlessUsers } = await ticketlessClient
    .from('user_profiles')
    .select('email, home_address_ward, home_address_section')
    .not('home_address_ward', 'is', null)
    .not('home_address_section', 'is', null);
    
  console.log('Ticketless Users with Street Cleaning Addresses:', ticketlessUsers?.length || 0);
  
  // Check how many user addresses would be affected by missing zones
  let affectedUsers = 0;
  ticketlessUsers?.forEach(user => {
    const userZone = user.home_address_ward + '-' + user.home_address_section;
    if (!scheduleMap.has(userZone)) {
      affectedUsers++;
    }
  });
  
  console.log('Users affected by missing schedule data:', affectedUsers);
  console.log('Percentage of users affected:', Math.round((affectedUsers / (ticketlessUsers?.length || 1)) * 100) + '%');
  
  // 5. Identify root causes
  console.log('\n🔍 5. ROOT CAUSE ANALYSIS');
  console.log('-'.repeat(40));
  
  // Check date range issues
  const { data: dateRange } = await mscClient
    .from('street_cleaning_schedule')
    .select('cleaning_date')
    .order('cleaning_date', { ascending: true })
    .limit(1);
    
  const { data: maxDate } = await mscClient
    .from('street_cleaning_schedule')
    .select('cleaning_date')
    .order('cleaning_date', { ascending: false })
    .limit(1);
    
  console.log('Schedule date range:');
  console.log('  Earliest:', dateRange?.[0]?.cleaning_date);
  console.log('  Latest:', maxDate?.[0]?.cleaning_date);
  console.log('  Query date (today):', today);
  
  // Check for zones with geometry but no current/future schedule
  const zonesOnlyInGeometry = Array.from(uniqueZones).filter(zone => !uniqueSchedules.has(zone));
  console.log('\nZones with geometry but no future cleaning:', zonesOnlyInGeometry.length);
  console.log('Sample zones with this issue:');
  zonesOnlyInGeometry.slice(0, 10).forEach(zone => {
    const [ward, section] = zone.split('-');
    console.log('    Ward ' + ward + ', Section ' + section);
  });
  
  return {
    totalZones: uniqueZones.size,
    zonesWithSchedule: uniqueSchedules.size,
    affectedUsers,
    totalUsers: ticketlessUsers?.length || 0,
    dateRange: {
      earliest: dateRange?.[0]?.cleaning_date,
      latest: maxDate?.[0]?.cleaning_date,
      today
    }
  };
}

analyzeSystemicIssues().catch(console.error);