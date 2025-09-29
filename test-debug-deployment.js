async function testDebugDeployment() {
  console.log('🧪 Testing new deployment with debug logging...');
  
  const deploymentUrl = 'https://ticketless-chicago-oiltcjq86-randyvollraths-projects.vercel.app';
  const testUrl = `${deploymentUrl}/api/find-section?address=1013%20W%20Webster`;
  
  console.log('Testing URL:', testUrl);
  
  try {
    const response = await fetch(testUrl);
    const data = await response.json();
    
    console.log('\n📊 API Response:');
    console.log('Ward:', data.ward);
    console.log('Section:', data.section);
    console.log('Next cleaning date:', data.nextCleaningDate);
    
    if (data.nextCleaningDate) {
      const cleaningDate = new Date(data.nextCleaningDate);
      const dayOfWeek = cleaningDate.getDay();
      const dayName = cleaningDate.toLocaleDateString('en-US', { weekday: 'long' });
      
      console.log(`Date details: ${data.nextCleaningDate} (${dayName}, day=${dayOfWeek})`);
      
      if (dayOfWeek === 0) {
        console.log('🚨 STILL BROKEN: API returned Sunday date!');
        console.log('Expected: 2025-09-30 (Monday)');
        console.log('Actual:', data.nextCleaningDate, '(Sunday)');
        
        console.log('\n🔍 Checking Vercel logs for debug output...');
        console.log('The debug logging should show:');
        console.log('- "🧪 DEBUG: Starting filtering process for X entries"');
        console.log('- "🔍 DEBUG: Checking date 2025-09-29, dayOfWeek=0 (0=Sunday)"');
        console.log('- "Filtering out invalid Sunday cleaning date: 2025-09-29"');
        console.log('- "✅ DEBUG: After filtering, scheduleEntries: [2025-09-30]"');
      } else {
        console.log('✅ SUCCESS: Sunday filter is working!');
        console.log('API correctly returned a weekday instead of Sunday');
      }
    } else {
      console.log('❌ No cleaning date returned');
    }
    
  } catch (error) {
    console.error('❌ Error testing API:', error.message);
  }
}

testDebugDeployment();