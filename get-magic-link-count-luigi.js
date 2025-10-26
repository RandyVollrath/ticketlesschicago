const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function getMagicLink() {
  const email = 'countluigivampa@gmail.com';

  console.log('Generating magic link for:', email);
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/settings`
    }
  });

  if (linkError) {
    console.error('Error generating magic link:', linkError);
    return;
  }

  console.log('\n✅ MAGIC LINK GENERATED!\n');
  console.log('Send this link to the user:');
  console.log('\n' + linkData.properties.action_link + '\n');
  console.log('This link expires in 60 minutes.');
}

getMagicLink().catch(console.error);
