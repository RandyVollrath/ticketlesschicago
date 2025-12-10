#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser() {
  const email = 'hellodolldarlings@gmail.com';
  
  console.log('🔍 Checking residency proof for:', email);
  
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const authUser = users.find(u => u.email === email);
  
  if (!authUser) {
    console.log('❌ User not found');
    return;
  }
  
  console.log('✅ User ID:', authUser.id);
  
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select(`
      user_id,
      email,
      first_name,
      last_name,
      license_plate,
      street_address,
      has_permit_zone,
      residency_proof_path,
      residency_proof_type,
      residency_proof_uploaded_at,
      residency_proof_verified,
      residency_proof_verified_at,
      residency_proof_rejection_reason
    `)
    .eq('user_id', authUser.id)
    .single();
    
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('\n📋 Profile Data:');
  console.log(JSON.stringify(profile, null, 2));
  
  console.log('\n🔍 Checking if document shows in admin query...');
  
  // Simulate admin portal query
  const { data: profiles, error: adminError } = await supabase
    .from('user_profiles')
    .select('user_id, street_address, residency_proof_type, residency_proof_path, residency_proof_uploaded_at, residency_proof_verified')
    .not('residency_proof_path', 'is', null)
    .order('residency_proof_uploaded_at', { ascending: false });
  
  if (adminError) {
    console.error('❌ Admin query error:', adminError);
    return;
  }
  
  console.log(`\n📊 Total profiles with residency_proof_path: ${profiles?.length || 0}`);
  
  const hellodollProfile = profiles?.find(p => p.user_id === authUser.id);
  if (hellodollProfile) {
    console.log('✅ hellodolldarlings FOUND in admin query');
    console.log(JSON.stringify(hellodollProfile, null, 2));
  } else {
    console.log('❌ hellodolldarlings NOT FOUND in admin query');
  }
}

checkUser().catch(console.error);
