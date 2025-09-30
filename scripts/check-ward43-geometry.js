const { createClient } = require('@supabase/supabase-js');

const mscSupabase = createClient(
  'https://zqljxkqdgfibfzdjfjiq.supabase.co',
  '***REMOVED_MSC_SERVICE_ROLE_KEY***'
);

async function checkGeometry() {
  console.log('🔍 Checking Ward 43, Section 1 geometry data\n');
  
  // Get all Ward 43, Section 1 rows
  const { data, error } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('cleaning_date, street_name, side, geom, geom_simplified, ward, section')
    .eq('ward', '43')
    .eq('section', '1')
    .limit(10);
  
  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  console.log(`Found ${data.length} rows for Ward 43, Section 1\n`);
  
  let hasGeometry = 0;
  let noGeometry = 0;
  
  data.forEach((row, i) => {
    console.log(`Row ${i + 1}:`);
    console.log('  Date:', row.cleaning_date);
    console.log('  Street:', row.street_name || 'NULL');
    console.log('  Side:', row.side || 'NULL');
    console.log('  Has geom:', row.geom ? '✅ YES' : '❌ NO');
    console.log('  Has geom_simplified:', row.geom_simplified ? '✅ YES' : '❌ NO');
    console.log('');
    
    if (row.geom_simplified) hasGeometry++;
    else noGeometry++;
  });
  
  console.log('Summary:');
  console.log('  Rows with geometry:', hasGeometry);
  console.log('  Rows without geometry:', noGeometry);
  
  if (noGeometry > 0) {
    console.log('\n❌ PROBLEM: Some rows missing geometry!');
    console.log('   This is why Ward 43, Section 1 doesn\'t show in settings.');
    console.log('   API filters out zones without geom_simplified.');
  }
  
  // Check what the API would return
  console.log('\n🔍 Checking what API returns...\n');
  
  const { data: apiData, error: apiError } = await mscSupabase
    .from('street_cleaning_schedule')
    .select('ward, section, geom_simplified')
    .not('geom_simplified', 'is', null)
    .not('ward', 'is', null)
    .not('section', 'is', null)
    .eq('ward', '43')
    .eq('section', '1');
  
  if (apiError) {
    console.error('❌ API Error:', apiError.message);
  } else if (apiData.length === 0) {
    console.log('❌ API returns ZERO rows for Ward 43, Section 1');
    console.log('   This is why the "Invalid ward/section" error shows!');
  } else {
    console.log('✅ API returns', apiData.length, 'rows');
  }
}

checkGeometry().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
