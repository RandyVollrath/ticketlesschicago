#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAdminQuery() {
  console.log('🔍 Testing admin portal query...\n');
  
  // Exact query from permit-documents.ts lines 125-129
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, street_address, home_address_full, city_sticker_expiry, residency_proof_type, residency_proof_path, residency_proof_uploaded_at, residency_proof_verified')
    .not('residency_proof_path', 'is', null)
    .order('residency_proof_uploaded_at', { ascending: false });

  if (profileError) {
    console.error('❌ Query error:', profileError);
    return;
  }

  console.log(`✅ Found ${profiles.length} profiles with residency proofs\n`);

  // Get user emails
  const profileUserIds = profiles.map(p => p.user_id);
  const { data: profileUsers } = await supabase
    .from('users')
    .select('id, email, phone')
    .in('id', profileUserIds);

  const profileUserMap = new Map();
  profileUsers?.forEach(u => profileUserMap.set(u.id, u));

  // Map to residency proof docs (lines 142-172)
  const residencyProofDocs = profiles.map((profile) => {
    const user = profileUserMap.get(profile.user_id);
    return {
      id: `profile-${profile.user_id}`,
      user_id: profile.user_id,
      document_url: profile.residency_proof_path,
      document_type: profile.residency_proof_type || 'unknown',
      document_source: 'manual_upload', // Removed the non-existent column
      address: profile.street_address || profile.home_address_full || 'Unknown',
      verification_status: profile.residency_proof_verified ? 'approved' : 'pending',
      uploaded_at: profile.residency_proof_uploaded_at,
      user_email: user?.email || 'Unknown',
      user_phone: user?.phone || 'Unknown',
      user_name: user?.email || 'Unknown User',
      is_residency_proof: true,
    };
  });

  console.log('📊 Residency Proof Documents:\n');
  residencyProofDocs.forEach((doc, i) => {
    console.log(`${i + 1}. ${doc.user_email}`);
    console.log(`   Status: ${doc.verification_status}`);
    console.log(`   Document URL: ${doc.document_url}`);
    console.log(`   Type: ${doc.document_type}`);
    console.log('');
  });

  // Check what hellodolldarlings looks like
  const hellodoll = residencyProofDocs.find(d => d.user_email === 'hellodolldarlings@gmail.com');
  if (hellodoll) {
    console.log('🎯 hellodolldarlings document:');
    console.log(JSON.stringify(hellodoll, null, 2));
  }
}

testAdminQuery().catch(console.error);
