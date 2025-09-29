#!/usr/bin/env node

// Check street cleaning data for Randy
// Run: node scripts/check-street-cleaning-data.js

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkStreetCleaningData() {
  console.log('🧹 STREET CLEANING DATA CHECK\n');
  console.log('=' .repeat(60));
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  console.log(`Today: ${today.toISOString().split('T')[0]}\n`);
  
  // Randy's data from the user_profiles dump
  const randy = {
    email: 'randyvollrath@gmail.com',
    ward: 43,
    section: 1,
    address: '1013 W Webster Ave'
  };
  
  console.log('👤 Randy\'s Street Cleaning Info:');
  console.log(`  Address: ${randy.address}`);
  console.log(`  Ward: ${randy.ward}`);
  console.log(`  Section: ${randy.section}`);
  
  // Check if there's a street_cleaning_schedule table
  console.log('\n📊 Checking street_cleaning_schedule table...');
  
  const { data: schedule, error: scheduleError } = await supabase
    .from('street_cleaning_schedule')
    .select('*')
    .eq('ward', randy.ward)
    .eq('section', randy.section)
    .gte('cleaning_date', today.toISOString())
    .order('cleaning_date', { ascending: true })
    .limit(5);
    
  if (scheduleError) {
    console.log('❌ Error fetching schedule:', scheduleError.message);
    console.log('\n⚠️  This might mean:');
    console.log('  1. street_cleaning_schedule table doesn\'t exist');
    console.log('  2. You don\'t have access to it');
    console.log('  3. The table is in the MyStreetCleaning database, not this one');
    
    // Try MSC database if configured
    if (process.env.MSC_SUPABASE_URL && process.env.MSC_SUPABASE_SERVICE_ROLE_KEY) {
      console.log('\n🔄 Trying MyStreetCleaning database...');
      
      const mscSupabase = createClient(
        process.env.MSC_SUPABASE_URL,
        process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data: mscSchedule, error: mscError } = await mscSupabase
        .from('street_cleaning_schedule')
        .select('*')
        .eq('ward', randy.ward)
        .eq('section', randy.section)
        .gte('cleaning_date', today.toISOString())
        .order('cleaning_date', { ascending: true })
        .limit(5);
        
      if (!mscError && mscSchedule) {
        console.log('✅ Found schedule in MyStreetCleaning database!');
        console.log('\nNext 5 cleaning dates:');
        mscSchedule.forEach(s => {
          const date = new Date(s.cleaning_date);
          const days = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          console.log(`  ${s.cleaning_date}: ${days} days away`);
        });
      } else {
        console.log('❌ Could not fetch from MSC database either:', mscError?.message);
      }
    }
  } else if (!schedule || schedule.length === 0) {
    console.log('⚠️  No upcoming street cleaning dates found for Ward 43, Section 1');
  } else {
    console.log('✅ Found street cleaning schedule!');
    console.log('\nNext cleaning dates:');
    schedule.forEach(s => {
      const date = new Date(s.cleaning_date);
      date.setUTCHours(0, 0, 0, 0);
      const days = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const shouldNotify = [0, 1, 2, 3].includes(days); // Based on Randy's notify_days_array
      console.log(`  ${s.cleaning_date}: ${days} days away ${shouldNotify ? '📨 Would notify' : ''}`);
    });
  }
  
  console.log('\n🔍 DIAGNOSIS:');
  console.log('------------');
  console.log('Street cleaning notifications depend on:');
  console.log('1. ✅ User has ward/section data (Randy has Ward 43, Section 1)');
  console.log('2. ❓ street_cleaning_schedule table exists with data');
  console.log('3. ❌ Cron jobs are scheduled (NOT IN vercel.json!)');
  console.log('4. ✅ notify_days_array includes matching days ([0,1,2,3] for Randy)');
  
  console.log('\n💡 SOLUTION:');
  console.log('1. Deploy the updated vercel.json with street cleaning crons');
  console.log('2. Verify street_cleaning_schedule table has data');
  console.log('3. Or rely on MyStreetCleaning.com for notifications');
}

checkStreetCleaningData().catch(console.error);