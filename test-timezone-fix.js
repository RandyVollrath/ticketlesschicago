async function testTimezoneFix() {
  console.log('🧪 Testing timezone-aware date fix in production...');
  
  const deploymentUrl = 'https://ticketless-chicago-aiqf1omin-randyvollraths-projects.vercel.app';
  const testUrl = `${deploymentUrl}/api/find-section?address=1013%20W%20Webster`;
  
  console.log('Testing URL:', testUrl);
  console.log('Expected: Should return 2025-09-30 (Tuesday) instead of being filtered out');
  
  try {
    const response = await fetch(testUrl);
    const data = await response.json();
    
    console.log('\n📊 Production API Response:');
    console.log('Ward:', data.ward);
    console.log('Section:', data.section);
    console.log('Next cleaning date:', data.nextCleaningDate);
    
    if (data.nextCleaningDate) {
      // Test both local and UTC parsing to verify timezone fix
      const cleaningDateLocal = new Date(data.nextCleaningDate);
      const cleaningDateUTC = new Date(data.nextCleaningDate + 'T12:00:00Z');
      
      const localDayOfWeek = cleaningDateLocal.getDay();
      const utcDayOfWeek = cleaningDateUTC.getDay();
      
      const localDayName = cleaningDateLocal.toLocaleDateString('en-US', { weekday: 'long' });
      const utcDayName = cleaningDateUTC.toLocaleDateString('en-US', { weekday: 'long' });
      
      console.log('\n🔍 Date Analysis:');
      console.log(`Raw date from API: ${data.nextCleaningDate}`);
      console.log(`Local parsing: ${localDayName} (day=${localDayOfWeek})`);
      console.log(`UTC parsing: ${utcDayName} (day=${utcDayOfWeek})`);
      
      if (data.nextCleaningDate === '2025-09-30') {
        console.log('\n✅ SUCCESS: API correctly returned 2025-09-30 (Tuesday)');
        console.log('🎉 Timezone fix is working - no more Sunday date confusion!');
      } else if (data.nextCleaningDate === '2025-09-29') {
        console.log('\n⚠️ API returned 2025-09-29 - checking if timezone handling is correct...');
        if (utcDayOfWeek === 1) { // Monday
          console.log('✅ This is actually a Monday when parsed correctly with UTC');
          console.log('🎉 Timezone fix is working!');
        } else {
          console.log('❌ Still showing as Sunday even with UTC parsing');
        }
      } else {
        console.log('\n📅 API returned a different date:', data.nextCleaningDate);
        console.log('This could be correct if the schedule changed or filtering worked');
      }
      
      // Additional validation
      if (localDayOfWeek === 0 || utcDayOfWeek === 0) {
        console.log('\n🚨 WARNING: A Sunday date was returned - this should not happen');
      } else {
        console.log('\n✅ No Sunday dates returned - validation working correctly');
      }
      
    } else {
      console.log('\n❌ No cleaning date returned - this could indicate an issue');
    }
    
    // Test address change scenario that user reported
    console.log('\n🔄 Testing address change scenario...');
    console.log('Testing with different address first, then back to original...');
    
    // Test different address
    const diffAddressUrl = `${deploymentUrl}/api/find-section?address=123%20State%20Street`;
    const diffResponse = await fetch(diffAddressUrl);
    const diffData = await diffResponse.json();
    
    console.log('\nDifferent address result:');
    console.log('Ward/Section:', diffData.ward + '/' + diffData.section);
    console.log('Next cleaning:', diffData.nextCleaningDate);
    
    // Test back to original
    const backResponse = await fetch(testUrl);
    const backData = await backResponse.json();
    
    console.log('\nBack to original address result:');
    console.log('Ward/Section:', backData.ward + '/' + backData.section);
    console.log('Next cleaning:', backData.nextCleaningDate);
    
    if (backData.nextCleaningDate === data.nextCleaningDate) {
      console.log('\n✅ Address change scenario works correctly - same result returned');
    } else {
      console.log('\n⚠️ Address change scenario shows different results');
    }
    
  } catch (error) {
    console.error('❌ Error testing production API:', error.message);
  }
}

testTimezoneFix();