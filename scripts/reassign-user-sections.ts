/**
 * Reassign User Ward/Section After Schedule Data Reload
 *
 * When street cleaning schedule data is reloaded (e.g., new season, mid-season changes),
 * user ward/section assignments may become stale. This script re-runs the PostGIS
 * find_section_for_point RPC for every user who has coordinates (lat/lng) and updates
 * their home_address_ward and home_address_section if the lookup returns a different result.
 *
 * Usage:
 *   npx tsx scripts/reassign-user-sections.ts
 *   npx tsx scripts/reassign-user-sections.ts --dry-run   # Preview changes without applying
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`\n🔄 Reassigning user ward/section assignments${isDryRun ? ' (DRY RUN)' : ''}...\n`);

  // Fetch all users who have coordinates
  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, home_address, home_address_ward, home_address_section, home_address_lat, home_address_lng')
    .not('home_address_lat', 'is', null)
    .not('home_address_lng', 'is', null);

  if (error) {
    console.error('❌ Failed to fetch users:', error.message);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log('No users with coordinates found.');
    return;
  }

  console.log(`Found ${users.length} users with coordinates.\n`);

  let updated = 0;
  let unchanged = 0;
  let noMatch = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const { data: result, error: rpcError } = await supabase.rpc('find_section_for_point', {
        lon: user.home_address_lng,
        lat: user.home_address_lat,
      });

      if (rpcError || !result || result.length === 0) {
        console.log(`  ⚠️  ${user.email}: No section match at (${user.home_address_lat}, ${user.home_address_lng})`);
        noMatch++;
        continue;
      }

      const newWard = result[0].ward;
      const newSection = result[0].section;

      if (newWard === user.home_address_ward && newSection === user.home_address_section) {
        unchanged++;
        continue;
      }

      console.log(`  📝 ${user.email}: W${user.home_address_ward}/S${user.home_address_section} → W${newWard}/S${newSection}${user.home_address ? ` (${user.home_address})` : ''}`);

      if (!isDryRun) {
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update({
            home_address_ward: newWard,
            home_address_section: newSection,
          })
          .eq('user_id', user.user_id);

        if (updateError) {
          console.error(`    ❌ Update failed: ${updateError.message}`);
          errors++;
          continue;
        }
      }

      updated++;
    } catch (err: any) {
      console.error(`  ❌ ${user.email}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  Updated:   ${updated}${isDryRun ? ' (would update)' : ''}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  No match:  ${noMatch}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  Total:     ${users.length}`);

  if (isDryRun && updated > 0) {
    console.log(`\n💡 Run without --dry-run to apply changes.`);
  }
}

main().catch(console.error);
