// Quick test to verify the notification system will work
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('\n🔍 Testing notification system requirements...\n');
  
  // Test 1: Check if user_profiles table has required columns
  console.log('1. Checking user_profiles table structure...');
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, has_protection, has_permit_zone, city_sticker_expiry, email, phone_number')
    .limit(1);
    
  if (profileError) {
    console.error('❌ Error accessing user_profiles:', profileError.message);
    return;
  }
  
  if (!profiles || profiles.length === 0) {
    console.log('⚠️  No users found in user_profiles table');
  } else {
    console.log('✅ user_profiles table accessible');
    console.log('   Sample fields:', Object.keys(profiles[0]));
    
    // Test 2: Check field values
    const sample = profiles[0];
    console.log('\n2. Sample user data:');
    console.log(`   has_protection: ${sample.has_protection !== undefined ? '✅ exists' : '❌ missing'}`);
    console.log(`   has_permit_zone: ${sample.has_permit_zone !== undefined ? '✅ exists' : '❌ missing'}`);
    console.log(`   city_sticker_expiry: ${sample.city_sticker_expiry !== undefined ? '✅ exists' : '❌ missing'}`);
  }
  
  // Test 3: Check for users with Protection
  console.log('\n3. Checking for Protection users...');
  const { data: protectionUsers, error: protectionError } = await supabase
    .from('user_profiles')
    .select('user_id, email, has_protection, has_permit_zone')
    .eq('has_protection', true)
    .limit(5);
    
  if (protectionError) {
    console.log('⚠️  Could not query Protection users:', protectionError.message);
  } else {
    console.log(`✅ Found ${protectionUsers?.length || 0} Protection users`);
    if (protectionUsers && protectionUsers.length > 0) {
      console.log('   Sample Protection user:', {
        email: protectionUsers[0].email,
        has_protection: protectionUsers[0].has_protection,
        has_permit_zone: protectionUsers[0].has_permit_zone
      });
    }
  }
  
  console.log('\n✅ System checks complete!\n');
}

test().catch(console.error);
