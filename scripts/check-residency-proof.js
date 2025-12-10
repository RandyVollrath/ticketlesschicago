#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });

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
      residency_proof_source,
      residency_proof_uploaded_at,
      residency_proof_verified,
      residency_proof_verified_at,
      residency_proof_rejection_reason,
      residency_proof_validation,
      residency_proof_validated_at
    `)
    .eq('user_id', authUser.id)
    .single();
    
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('\n📋 Profile Data:');
  console.log(JSON.stringify(profile, null, 2));
}

checkUser().catch(console.error);
