require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkUser(email) {
  console.log(`\n🔍 Checking user: ${email}\n`);

  // Get user by email
  const { data: { users }, error } = await supabase.auth.admin.listUsers();

  if (error) {
    console.error('Error fetching users:', error);
    return;
  }

  const user = users.find(u => u.email === email);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  console.log('✅ User found');
  console.log('User ID:', user.id);
  console.log('Email:', user.email);
  console.log('Email confirmed:', user.email_confirmed_at ? '✅ Yes' : '❌ No');
  console.log('Created at:', user.created_at);
  console.log('Last sign in:', user.last_sign_in_at);

  // Check identities (auth providers)
  console.log('\n📱 Auth Providers:');
  if (user.identities && user.identities.length > 0) {
    user.identities.forEach(identity => {
      console.log(`  - ${identity.provider} (created: ${identity.created_at})`);
      if (identity.identity_data) {
        console.log(`    Email: ${identity.identity_data.email}`);
        console.log(`    Provider: ${identity.identity_data.provider}`);
      }
    });
  } else {
    console.log('  No auth providers found (email/password user)');
  }

  console.log('\n💡 Recommendation:');
  const hasGoogleAuth = user.identities?.some(i => i.provider === 'google');
  const hasEmailAuth = user.identities?.some(i => i.provider === 'email');

  if (hasGoogleAuth && !hasEmailAuth) {
    console.log('  This user ONLY has Google authentication.');
    console.log('  They CANNOT use email/password or magic links.');
    console.log('  They MUST use "Continue with Google" to sign in.');
  } else if (hasEmailAuth && !hasGoogleAuth) {
    console.log('  This user uses email/password authentication.');
    console.log('  They can use magic links OR password to sign in.');
  } else if (hasGoogleAuth && hasEmailAuth) {
    console.log('  This user has BOTH Google and email authentication.');
    console.log('  They can use either method to sign in.');
  } else {
    console.log('  This user has no standard auth providers.');
    console.log('  This is unusual - they may have been created via admin API.');
  }
}

const email = process.argv[2] || 'heyliberalname@gmail.com';
checkUser(email);
