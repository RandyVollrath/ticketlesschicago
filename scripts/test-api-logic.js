const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  'https://zqljxkqdgfibfzdjfjiq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes'
);

async function testAPILogic() {
  console.log('🧪 Testing exact API logic\n');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  console.log('Today:', todayStr);
  
  // Step 1: Get all zones (exact API query)
  const { data: allZones, error: allZonesError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null');
  
  if (allZonesError) {
    console.error('Error getting zones:', allZonesError);
    return;
  }
  
  console.log('\n1️⃣  All zones query returned:', allZones.length, 'rows');
  
  // Check Ward 43 in allZones
  const ward43Zones = allZones.filter(z => z.ward === '43');
  console.log('   Ward 43 rows in query:', ward43Zones.length);
  
  // Get unique sections
  const ward43Sections = [...new Set(ward43Zones.map(z => z.section))].sort();
  console.log('   Ward 43 unique sections:', ward43Sections.join(', '));
  
  // Step 2: Process into zone map (API logic)
  const zoneMap = new Map();
  allZones.forEach(zone => {
    const zoneKey = `${zone.ward}-${zone.section}`;
    if (!zoneMap.has(zoneKey)) {
      zoneMap.set(zoneKey, {
        ward: zone.ward,
        section: zone.section,
        geom_simplified: zone.geom_simplified
      });
    }
  });
  
  console.log('\n2️⃣  Zone map created with', zoneMap.size, 'unique zones');
  
  // Check Ward 43 in zone map
  const ward43InMap = Array.from(zoneMap.values())
    .filter(z => z.ward === '43')
    .map(z => z.section)
    .sort();
  
  console.log('   Ward 43 sections in map:', ward43InMap.join(', '));
  
  // Check specific sections
  console.log('\n3️⃣  Checking specific sections:');
  console.log('   Has 43-1:', zoneMap.has('43-1') ? '✅' : '❌');
  console.log('   Has 43-6:', zoneMap.has('43-6') ? '✅' : '❌');
  
  if (ward43Sections.includes('1') && !ward43InMap.includes('1')) {
    console.log('\n❌ PROBLEM: Section 1 in query but not in map!');
  } else if (!ward43Sections.includes('1')) {
    console.log('\n❌ PROBLEM: Section 1 not even in initial query!');
  } else {
    console.log('\n✅ Section 1 present in both query and map');
  }
}

testAPILogic().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
