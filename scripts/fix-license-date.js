/**
 * Fix License Expiry Date
 *
 * Quick script to update the license expiry date in the database
 * Usage: node scripts/fix-license-date.js <email> <date>
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixLicenseDate(email, newDate) {
  console.log(`\n🔧 Fixing license expiry date for: ${email}`);
  console.log(`   New date: ${newDate}`);

  try {
    // Find user
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`✅ Found user: ${user.id}`);

    // Get current date
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('license_valid_until')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      console.log('❌ Profile not found:', profileError.message);
      return;
    }

    console.log(`📅 Current date in DB: ${profile.license_valid_until}`);

    // Update date
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ license_valid_until: newDate })
      .eq('user_id', user.id);

    if (updateError) {
      console.log('❌ Update failed:', updateError.message);
      return;
    }

    console.log(`✅ Successfully updated to: ${newDate}`);
    console.log(`\nDone! Refresh the settings page to see the new date.\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Get args
const email = process.argv[2];
const date = process.argv[3];

if (!email) {
  console.log('Usage: node scripts/fix-license-date.js <email> <date>');
  console.log('Example: node scripts/fix-license-date.js user@example.com 2027-06-30');
  console.log('To clear: node scripts/fix-license-date.js user@example.com null');
  process.exit(1);
}

// Validate date format (allow 'null' to clear)
if (date && date !== 'null' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.log('❌ Date must be in YYYY-MM-DD format (e.g., 2027-06-30) or "null" to clear');
  process.exit(1);
}

fixLicenseDate(email, date === 'null' ? null : date);
