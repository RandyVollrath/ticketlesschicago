const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load .env.local
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

async function addColumn() {
  console.log('🔧 Adding license_image_path_back column to user_profiles\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Use raw SQL to add the column
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS license_image_path_back TEXT,
      ADD COLUMN IF NOT EXISTS license_image_back_uploaded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS license_image_back_verified BOOLEAN DEFAULT FALSE;
    `
  });

  if (error) {
    console.error('❌ Error adding columns:', error);
    console.log('\n💡 Alternative: Run this SQL manually in Supabase SQL Editor:');
    console.log(`
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS license_image_path_back TEXT,
ADD COLUMN IF NOT EXISTS license_image_back_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS license_image_back_verified BOOLEAN DEFAULT FALSE;
    `);
  } else {
    console.log('✅ Columns added successfully!');
  }
}

addColumn().catch(console.error);
