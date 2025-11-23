#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTriggers() {
  // Try to query pg_catalog for triggers
  const { data, error } = await supabase
    .rpc('exec_sql', {
      query: `
        SELECT trigger_name, event_object_table, action_statement
        FROM information_schema.triggers
        WHERE event_object_schema = 'auth'
        AND event_object_table = 'users';
      `
    });

  if (error) {
    console.log('Cannot query triggers directly (RPC not available)');
    console.log('');
    console.log('But based on code analysis:');
    console.log('❌ There IS a trigger "on_auth_user_created" that calls handle_new_user()');
    console.log('');
    console.log('This trigger creates an empty user_profiles record');
    console.log('Then the webhook tries to INSERT and fails!');
    console.log('');
    console.log('SOLUTION: Change webhook to UPSERT instead of INSERT');
  } else {
    console.log('Triggers on auth.users:');
    console.log(data);
  }
}

checkTriggers().catch(console.error);
