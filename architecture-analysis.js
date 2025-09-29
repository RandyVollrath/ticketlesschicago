const { createClient } = require('@supabase/supabase-js');

async function compareArchitectureOptions() {
  console.log('🏗️  ARCHITECTURAL SOLUTIONS ANALYSIS');
  console.log('='.repeat(60));
  
  const mscClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const ticketlessClient = createClient(
    process.env.TICKETLESS_SUPABASE_URL,
    process.env.TICKETLESS_SERVICE_ROLE_KEY
  );

  console.log('\n📋 OPTION 1: MIGRATE MSC TABLE TO TICKETLESS AMERICA DATABASE');
  console.log('-'.repeat(60));
  
  // Check MSC table size and structure
  const { data: mscSample } = await mscClient
    .from('street_cleaning_schedule')
    .select('*')
    .limit(3);
    
  const { count: mscCount } = await mscClient
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });
    
  console.log('✅ PROS:');
  console.log('  • Single database = simpler architecture');
  console.log('  • No cross-database latency/reliability issues');
  console.log('  • Direct SQL joins possible');
  console.log('  • Easier debugging and maintenance');
  console.log('  • Better RLS (Row Level Security) integration');
  console.log('  • Reduced environment variable complexity');
  
  console.log('\n❌ CONS:');
  console.log('  • Data duplication (MSC still needs its own copy)');
  console.log('  • Sync complexity between MSC and TA databases');
  console.log('  • Storage costs in TA database');
  console.log('  • Migration complexity');
  
  console.log('\n📊 MIGRATION SCOPE:');
  console.log('  • Records to migrate:', mscCount || 'unknown');
  console.log('  • Table structure complexity: HIGH (geometry, dates, metadata)');
  
  if (mscSample && mscSample[0]) {
    console.log('  • Columns:', Object.keys(mscSample[0]).length);
    console.log('  • Sample columns:', Object.keys(mscSample[0]).slice(0, 10).join(', '));
  }
  
  console.log('\n📋 OPTION 2: FIX CROSS-DATABASE INTEGRATION');
  console.log('-'.repeat(60));
  
  console.log('✅ PROS:');
  console.log('  • No data duplication');
  console.log('  • MSC remains authoritative source');
  console.log('  • Smaller TA database');
  console.log('  • Less migration work');
  
  console.log('\n❌ CONS:');
  console.log('  • Cross-database queries prone to failures');
  console.log('  • Environment variable management complexity');
  console.log('  • Harder to debug across databases');
  console.log('  • Network latency between databases');
  console.log('  • Different RLS policies and permissions');
  
  console.log('\n🔧 REQUIRED FIXES FOR OPTION 2:');
  console.log('  • Data cleaning (remove corrupted dates)');
  console.log('  • Fix geometry/schedule mapping logic');
  console.log('  • Improve error handling and fallbacks');
  console.log('  • Add data validation layers');
  
  console.log('\n📋 OPTION 3: HYBRID APPROACH');
  console.log('-'.repeat(60));
  
  console.log('📝 CONCEPT:');
  console.log('  • Migrate ONLY essential fields to TA');
  console.log('  • Keep MSC as source of truth for full data');
  console.log('  • Periodic sync of essential data');
  
  console.log('\n✅ PROS:');
  console.log('  • Fast local queries for user notifications');
  console.log('  • Reduced cross-database dependency');
  console.log('  • Smaller migration scope');
  console.log('  • MSC remains authoritative');
  
  console.log('\n❌ CONS:');
  console.log('  • Sync complexity');
  console.log('  • Data freshness concerns');
  console.log('  • Still some duplication');
  
  console.log('\n🎯 RECOMMENDED SOLUTION ANALYSIS');
  console.log('-'.repeat(60));
  
  // Check current failure rate
  const today = new Date().toISOString().split('T')[0];
  const { data: validCleanings } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section', { count: 'exact', head: true })
    .gte('cleaning_date', today)
    .lte('cleaning_date', '2026-12-31'); // Reasonable date range
    
  const { data: totalWithGeom } = await mscClient
    .from('street_cleaning_schedule')
    .select('ward, section', { count: 'exact', head: true })
    .not('geom_simplified', 'is', null);
    
  const reliabilityScore = validCleanings && totalWithGeom ? 
    Math.round((validCleanings / totalWithGeom) * 100) : 0;
    
  console.log('Current System Reliability:', reliabilityScore + '%');
  
  if (reliabilityScore < 80) {
    console.log('\n🚨 RECOMMENDATION: MIGRATE TO SINGLE DATABASE');
    console.log('   Current cross-database reliability too low for production');
    console.log('   Data corruption in MSC requires cleanup during migration');
  } else {
    console.log('\n💡 RECOMMENDATION: FIX CROSS-DATABASE INTEGRATION');
    console.log('   Data quality sufficient, integration fixes needed');
  }
  
  return {
    mscRecordCount: mscCount,
    reliabilityScore,
    recommendation: reliabilityScore < 80 ? 'MIGRATE' : 'FIX_INTEGRATION'
  };
}

compareArchitectureOptions().catch(console.error);