const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testMagicLink(email) {
  console.log(`\n🔗 Testing magic link generation for: ${email}\n`);

  // Generate magic link
  const { data: linkData, error: magicLinkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
    }
  });

  if (magicLinkError) {
    console.error('❌ Error generating magic link:', magicLinkError);
    return;
  }

  if (!linkData?.properties?.action_link) {
    console.error('❌ No action link generated');
    return;
  }

  console.log('✅ Magic link generated!\n');
  console.log('📧 Email:', linkData.user.email);
  console.log('🔗 Action Link:', linkData.properties.action_link);
  console.log('\n📝 Link details:');
  console.log('  - Token type:', linkData.properties.action_link.includes('type=magiclink') ? 'magiclink' : 'unknown');
  console.log('  - Has token:', linkData.properties.action_link.includes('token='));
  console.log('  - Redirect to:', linkData.properties.redirect_to);

  // Parse URL to check structure
  const url = new URL(linkData.properties.action_link);
  console.log('\n🔍 URL analysis:');
  console.log('  - Host:', url.host);
  console.log('  - Path:', url.pathname);
  console.log('  - Query params:');
  url.searchParams.forEach((value, key) => {
    if (key === 'token') {
      console.log(`    ${key}: ${value.substring(0, 20)}...`);
    } else {
      console.log(`    ${key}: ${value}`);
    }
  });
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node test-magic-link.js EMAIL');
  process.exit(1);
}

testMagicLink(email);
