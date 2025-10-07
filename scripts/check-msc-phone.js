#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Check if MSC credentials exist
const mscUrl = process.env.MSC_SUPABASE_URL;
const mscKey = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

if (!mscUrl || !mscKey) {
  console.log('MSC database credentials not found in environment');
  console.log('MSC_SUPABASE_URL:', mscUrl ? 'Set' : 'Not set');
  console.log('MSC_SUPABASE_SERVICE_ROLE_KEY:', mscKey ? 'Set' : 'Not set');
  process.exit(1);
}

const mscSupabase = createClient(mscUrl, mscKey);

async function checkMSCPhone() {
  const phone = '13125354254';
  const phoneVariants = [
    phone,
    '+' + phone,
    '+1' + phone.substring(1),
    phone.replace(/^1/, '') // Remove leading 1
  ];

  console.log('Searching MSC database for phone number:', phone);
  console.log('Checking variants:', phoneVariants);
  console.log('\n=== MSC USER PROFILES ===\n');

  try {
    // Check user_profiles in MSC database - just use phone_number field
    const { data: profiles, error: profileError } = await mscSupabase
      .from('user_profiles')
      .select('*')
      .or(phoneVariants.map(p => `phone_number.eq.${p}`).join(','));

    if (profileError) {
      console.error('Error querying MSC user_profiles:', profileError);
    } else if (profiles && profiles.length > 0) {
      console.log(`Found ${profiles.length} MSC profile(s):\n`);
      profiles.forEach((profile, idx) => {
        console.log(`Profile ${idx + 1}:`);
        console.log('  User ID:', profile.user_id);
        console.log('  Email:', profile.email);
        console.log('  Phone:', profile.phone);
        console.log('  Phone Number:', profile.phone_number);
        console.log('  Address:', profile.home_address_full);
        console.log('  Ward:', profile.home_address_ward);
        console.log('  Section:', profile.home_address_section);
        console.log('  SMS Enabled:', profile.notify_sms);
        console.log('  Voice Enabled:', profile.phone_call_enabled || profile.voice_calls_enabled);
        console.log('  Created:', profile.created_at);
        console.log('');
      });
    } else {
      console.log('No profiles found in MSC database with this phone number');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkMSCPhone().catch(console.error);
