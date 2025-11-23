#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser(email) {
  console.log(`Checking user: ${email}`);

  // Check auth user
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const authUser = users.find(u => u.email === email);

  if (!authUser) {
    console.log('AUTH USER NOT FOUND - webhook never created auth account');
    return;
  }

  console.log('Auth user ID:', authUser.id);
  console.log('Email confirmed:', authUser.email_confirmed_at ? 'YES' : 'NO');

  // Check profile
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', authUser.id)
    .single();

  if (error) {
    console.log('PROFILE NOT FOUND:', error.message);
    console.log('Webhook failed to create profile!');
    return;
  }

  console.log('Profile exists: YES');
  console.log('Has protection:', profile.has_protection);
  console.log('Phone:', profile.phone_number || 'NONE');
  console.log('Address:', profile.street_address || 'NONE');
  console.log('Permit zone:', profile.has_permit_zone);
  console.log('Created at:', profile.created_at);

  // Generate magic link
  console.log('\nGenerating magic link...');
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?protection=true`
    }
  });

  if (linkError) {
    console.log('ERROR generating link:', linkError.message);
  } else {
    console.log('\nMAGIC LINK:');
    console.log(linkData.properties.action_link);
    console.log('\nSend this to the user!');
  }
}

checkUser('countluigivampa@gmail.com').catch(console.error);
