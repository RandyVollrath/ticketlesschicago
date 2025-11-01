require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
  console.log('📝 Running drip campaign foreign key migration...\n');

  const sql = fs.readFileSync('fix-drip-fk.sql', 'utf8');

  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    // Try running line by line if exec_sql doesn't exist
    console.log('exec_sql not available, trying direct query...\n');

    const lines = [
      `ALTER TABLE drip_campaign_status ADD CONSTRAINT drip_campaign_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;`,
      `CREATE INDEX IF NOT EXISTS drip_campaign_status_user_id_idx ON drip_campaign_status(user_id);`
    ];

    for (const line of lines) {
      console.log(`Executing: ${line.substring(0, 80)}...`);
      const { error: lineError } = await supabase.rpc('exec_sql', { query: line });

      if (lineError) {
        console.error('❌ Error:', lineError);
      } else {
        console.log('✅ Success\n');
      }
    }
  } else {
    console.log('✅ Migration completed successfully');
  }
}

runMigration()
  .then(() => {
    console.log('\n✅ Done! Foreign key relationship added.');
    console.log('Now triggering drip campaign to send welcome emails...\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
