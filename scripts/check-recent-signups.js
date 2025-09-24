#!/usr/bin/env node

// Check recent signups and their data
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkRecentActivity() {
  console.log('Recent Activity Report');
  console.log('=' . repeat(50));
  
  // Get recent users
  console.log('\n📊 Users created in last 7 days:');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { data: recentUsers, error: userError } = await supabase
    .from('users')
    .select('id, email, created_at')
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false });
  
  if (recentUsers && recentUsers.length > 0) {
    for (const user of recentUsers) {
      const created = new Date(user.created_at);
      const hoursAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60));
      
      // Check if they have vehicle data
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('license_plate, subscription_status')
        .eq('user_id', user.id);
      
      const hasVehicle = vehicles && vehicles.length > 0;
      const status = hasVehicle ? `✅ Has vehicle: ${vehicles[0].license_plate}` : '❌ No vehicle data';
      
      console.log(`   ${user.email} (${hoursAgo}h ago) - ${status}`);
    }
  } else {
    console.log('   No recent users');
  }
  
  // Get recent vehicles
  console.log('\n📊 Vehicles created in last 7 days:');
  const { data: recentVehicles } = await supabase
    .from('vehicles')
    .select('license_plate, created_at, user_id')
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (recentVehicles && recentVehicles.length > 0) {
    for (const vehicle of recentVehicles) {
      const created = new Date(vehicle.created_at);
      const hoursAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60));
      
      // Get user email
      const { data: user } = await supabase
        .from('users')
        .select('email')
        .eq('id', vehicle.user_id)
        .single();
      
      console.log(`   ${vehicle.license_plate} - ${user?.email || 'Unknown'} (${hoursAgo}h ago)`);
    }
  } else {
    console.log('   No recent vehicles');
  }
  
  // Summary
  console.log('\n📈 Summary:');
  const usersWithVehicles = recentUsers?.filter(async u => {
    const { data } = await supabase.from('vehicles').select('id').eq('user_id', u.id).single();
    return !!data;
  }).length || 0;
  
  console.log(`   Total recent users: ${recentUsers?.length || 0}`);
  console.log(`   Total recent vehicles: ${recentVehicles?.length || 0}`);
  console.log(`   Webhook success rate: ${recentVehicles?.length || 0}/${recentUsers?.length || 1} (${Math.round(((recentVehicles?.length || 0) / (recentUsers?.length || 1)) * 100)}%)`);
}

checkRecentActivity().catch(console.error);