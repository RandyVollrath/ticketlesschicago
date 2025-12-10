#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnose() {
  const email = 'hellodolldarlings@gmail.com';
  
  console.log('🔍 DIAGNOSIS: hellodolldarlings@gmail.com document visibility issue\n');
  console.log('=' .repeat(80));
  
  // 1. Check auth.users
  console.log('\n1️⃣  AUTH.USERS TABLE:');
  const { data: { users: authUsers } } = await supabase.auth.admin.listUsers();
  const authUser = authUsers.find(u => u.email === email);
  
  if (authUser) {
    console.log(`   ✅ Found: ${authUser.id}`);
    console.log(`   Created: ${authUser.created_at}`);
    console.log(`   Last sign in: ${authUser.last_sign_in_at}`);
  }
  
  // 2. Check public.users
  console.log('\n2️⃣  PUBLIC.USERS TABLE:');
  const { data: publicUsers } = await supabase
    .from('users')
    .select('*')
    .eq('email', email);
    
  if (publicUsers && publicUsers.length > 0) {
    console.log(`   Found ${publicUsers.length} record(s):`);
    publicUsers.forEach((u, i) => {
      console.log(`   ${i + 1}. ID: ${u.id}`);
      console.log(`      Email: ${u.email}`);
      console.log(`      Phone: ${u.phone}`);
      console.log(`      Created: ${u.created_at}`);
    });
  }
  
  // 3. Check user_profiles
  console.log('\n3️⃣  USER_PROFILES TABLE:');
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, email, residency_proof_path, residency_proof_verified')
    .eq('email', email);
    
  if (profiles && profiles.length > 0) {
    console.log(`   Found ${profiles.length} profile(s):`);
    profiles.forEach((p, i) => {
      console.log(`   ${i + 1}. User ID: ${p.user_id}`);
      console.log(`      Email: ${p.email}`);
      console.log(`      Has doc: ${p.residency_proof_path ? 'YES' : 'NO'}`);
      console.log(`      Verified: ${p.residency_proof_verified}`);
      if (p.residency_proof_path) {
        console.log(`      Path: ${p.residency_proof_path}`);
      }
    });
  }
  
  // 4. THE PROBLEM
  console.log('\n4️⃣  THE ISSUE:');
  if (authUser && profiles && profiles.length > 0) {
    const profile = profiles[0];
    console.log(`   auth.users ID:      ${authUser.id}`);
    console.log(`   user_profiles ID:   ${profile.user_id}`);
    
    const idsMatch = authUser.id === profile.user_id;
    console.log(`   IDs match:          ${idsMatch ? '✅ YES' : '❌ NO'}`);
    
    if (!idsMatch) {
      console.log('\n   ⚠️  MISMATCH DETECTED!');
      console.log('   The user_profiles record is using a different user_id than auth.users');
    }
    
    // Check if public.users has the profile's user_id
    const publicUserForProfile = publicUsers?.find(u => u.id === profile.user_id);
    const publicUserForAuth = publicUsers?.find(u => u.id === authUser.id);
    
    console.log(`\n   public.users has record for profile ID (${profile.user_id}): ${publicUserForProfile ? '✅ YES' : '❌ NO'}`);
    console.log(`   public.users has record for auth ID (${authUser.id}): ${publicUserForAuth ? '✅ YES' : '❌ NO'}`);
  }
  
  // 5. ADMIN QUERY SIMULATION
  console.log('\n5️⃣  ADMIN QUERY SIMULATION:');
  console.log('   Query: Get all profiles with residency_proof_path...');
  
  const { data: adminProfiles } = await supabase
    .from('user_profiles')
    .select('user_id, email, residency_proof_path, residency_proof_verified')
    .not('residency_proof_path', 'is', null);
    
  const hellodollProfile = adminProfiles?.find(p => p.email === email);
  
  if (hellodollProfile) {
    console.log(`   ✅ Profile found with document`);
    console.log(`      User ID: ${hellodollProfile.user_id}`);
    
    // Now fetch user info from public.users (this is what admin portal does)
    const { data: user } = await supabase
      .from('users')
      .select('id, email, phone')
      .eq('id', hellodollProfile.user_id)
      .single();
      
    if (user) {
      console.log(`   ✅ User info found in public.users`);
      console.log(`      Email: ${user.email}`);
      console.log(`      Phone: ${user.phone}`);
    } else {
      console.log(`   ❌ User info NOT found in public.users for ID: ${hellodollProfile.user_id}`);
      console.log('   This is why the admin portal shows "Unknown"');
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n💡 SOLUTION:');
  console.log('   The user_profiles.user_id needs to match the auth.users.id');
  console.log('   OR the public.users table needs a record with the correct user_id');
}

diagnose().catch(console.error);
