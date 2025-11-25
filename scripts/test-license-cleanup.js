/**
 * Test License Access Logging and 48-Hour Cleanup
 *
 * Tests:
 * 1. Simulates remitter accessing a license (updates license_last_accessed_at)
 * 2. Verifies the timestamp was updated
 * 3. Tests the cleanup cron job logic
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test user who opted OUT of multi-year storage
const TEST_USER_ID = '6bf5cc2c-ca08-4206-87b5-416fb4466101'; // mystreetcleaning+12

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  switch (command) {
    case 'status':
      await showStatus();
      break;
    case 'access':
      await simulateRemitterAccess();
      break;
    case 'check-cleanup':
      await checkWhatWouldBeDeleted();
      break;
    case 'run-cleanup':
      await runCleanupCron();
      break;
    case 'access-log':
      await showAccessLog();
      break;
    case 'force-old-timestamp':
      await forceOldTimestamp();
      break;
    default:
      console.log(`
Usage: node scripts/test-license-cleanup.js <command>

Commands:
  status           - Show current license status for test user
  access           - Simulate remitter accessing license (updates timestamp)
  access-log       - Show license access audit log
  check-cleanup    - Show what licenses WOULD be deleted by cleanup
  force-old-timestamp - Set timestamp to 49 hours ago (for testing cleanup)
  run-cleanup      - Actually run the cleanup cron job
      `);
  }
}

async function showStatus() {
  console.log('\n📋 License Status for Test Users\n');
  console.log('=' .repeat(80));

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, license_image_path, license_reuse_consent_given, license_last_accessed_at, license_image_uploaded_at')
    .not('license_image_path', 'is', null);

  if (error) {
    console.error('Error:', error);
    return;
  }

  for (const user of data) {
    const consent = user.license_reuse_consent_given ? '✅ YES' : '❌ NO';
    const accessed = user.license_last_accessed_at
      ? new Date(user.license_last_accessed_at).toLocaleString()
      : 'Never';

    let deletionStatus = '';
    if (!user.license_reuse_consent_given) {
      if (user.license_last_accessed_at) {
        const accessedAt = new Date(user.license_last_accessed_at);
        const deletionTime = new Date(accessedAt.getTime() + 48 * 60 * 60 * 1000);
        const now = new Date();
        if (now > deletionTime) {
          deletionStatus = '🗑️  ELIGIBLE FOR DELETION';
        } else {
          const hoursLeft = Math.round((deletionTime - now) / (60 * 60 * 1000));
          deletionStatus = `⏳ Delete in ${hoursLeft} hours`;
        }
      } else {
        deletionStatus = '⚠️  Will delete 48h after first access';
      }
    } else {
      deletionStatus = '🔒 Kept until license expires';
    }

    console.log(`\nUser: ${user.email}`);
    console.log(`  ID: ${user.user_id}`);
    console.log(`  Multi-year consent: ${consent}`);
    console.log(`  Last accessed: ${accessed}`);
    console.log(`  Status: ${deletionStatus}`);
    console.log(`  File: ${user.license_image_path}`);
  }
  console.log('\n');
}

async function simulateRemitterAccess() {
  console.log('\n🔐 Simulating Remitter Access to License\n');

  // Get current state
  const { data: before, error: beforeError } = await supabase
    .from('user_profiles')
    .select('license_last_accessed_at, license_image_path, license_reuse_consent_given')
    .eq('user_id', TEST_USER_ID)
    .single();

  if (beforeError || !before) {
    console.error('Test user not found');
    return;
  }

  console.log('Before access:');
  console.log(`  license_last_accessed_at: ${before.license_last_accessed_at || 'NULL'}`);

  // Update timestamp (simulating what get-driver-license.ts does)
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({ license_last_accessed_at: now })
    .eq('user_id', TEST_USER_ID);

  if (updateError) {
    console.error('Update error:', updateError);
    return;
  }

  // Also log to access log
  await supabase
    .from('license_access_log')
    .insert({
      user_id: TEST_USER_ID,
      accessed_at: now,
      accessed_by: 'test_script',
      reason: 'cleanup_testing',
      license_image_path: before.license_image_path,
      metadata: { test: true },
    });

  // Get after state
  const { data: after } = await supabase
    .from('user_profiles')
    .select('license_last_accessed_at')
    .eq('user_id', TEST_USER_ID)
    .single();

  console.log('\nAfter access:');
  console.log(`  license_last_accessed_at: ${after.license_last_accessed_at}`);

  if (!before.license_reuse_consent_given) {
    const deletionTime = new Date(new Date(after.license_last_accessed_at).getTime() + 48 * 60 * 60 * 1000);
    console.log(`\n⚠️  User opted OUT of multi-year storage`);
    console.log(`   License will be DELETED at: ${deletionTime.toLocaleString()}`);
  } else {
    console.log(`\n✅ User opted IN to multi-year storage - license kept until expiration`);
  }
}

async function showAccessLog() {
  console.log('\n📜 License Access Audit Log\n');
  console.log('=' .repeat(80));

  const { data, error } = await supabase
    .from('license_access_log')
    .select('*')
    .order('accessed_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No access logs found');
    return;
  }

  for (const log of data) {
    console.log(`\n${new Date(log.accessed_at).toLocaleString()}`);
    console.log(`  User: ${log.user_id}`);
    console.log(`  Accessed by: ${log.accessed_by}`);
    console.log(`  Reason: ${log.reason}`);
    console.log(`  IP: ${log.ip_address || 'N/A'}`);
  }
  console.log('\n');
}

async function checkWhatWouldBeDeleted() {
  console.log('\n🔍 Checking What Would Be Deleted by Cleanup Cron\n');
  console.log('=' .repeat(80));

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  console.log(`48 hours ago: ${new Date(fortyEightHoursAgo).toLocaleString()}`);

  // Category 1: Opted OUT users
  const { data: optedOut } = await supabase
    .from('user_profiles')
    .select('user_id, email, license_image_path, license_last_accessed_at, license_image_uploaded_at')
    .eq('license_reuse_consent_given', false)
    .not('license_image_path', 'is', null);

  console.log(`\n📁 Users who opted OUT of multi-year storage: ${optedOut?.length || 0}`);

  for (const user of optedOut || []) {
    const relevantDate = user.license_last_accessed_at || user.license_image_uploaded_at;
    const wouldDelete = !relevantDate || relevantDate < fortyEightHoursAgo;

    console.log(`\n  ${user.email}`);
    console.log(`    Relevant date: ${relevantDate ? new Date(relevantDate).toLocaleString() : 'NULL'}`);
    console.log(`    Would delete: ${wouldDelete ? '🗑️  YES' : '⏳ NO (not yet 48h)'}`);
  }

  // Category 2: Abandoned uploads
  const { data: abandoned } = await supabase
    .from('user_profiles')
    .select('user_id, email, license_image_path, license_image_uploaded_at')
    .eq('license_image_verified', false)
    .not('license_image_path', 'is', null)
    .lt('license_image_uploaded_at', fortyEightHoursAgo);

  console.log(`\n📁 Abandoned uploads (unverified >48h): ${abandoned?.length || 0}`);
  for (const user of abandoned || []) {
    console.log(`  - ${user.email}: ${user.license_image_path}`);
  }

  console.log('\n');
}

async function forceOldTimestamp() {
  console.log('\n⚙️  Setting test user timestamp to 49 hours ago\n');

  const fortyNineHoursAgo = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('user_profiles')
    .update({ license_last_accessed_at: fortyNineHoursAgo })
    .eq('user_id', TEST_USER_ID);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`✅ Set license_last_accessed_at to: ${new Date(fortyNineHoursAgo).toLocaleString()}`);
  console.log(`   This user should now be eligible for deletion by cleanup cron`);
  console.log(`\nRun 'node scripts/test-license-cleanup.js check-cleanup' to verify`);
}

async function runCleanupCron() {
  console.log('\n🧹 Running Cleanup Cron Job\n');
  console.log('=' .repeat(80));

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET not found in environment');
    return;
  }

  console.log(`Calling: ${baseUrl}/api/cron/cleanup-license-images`);

  try {
    const response = await fetch(`${baseUrl}/api/cron/cleanup-license-images`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
    });

    const result = await response.json();
    console.log('\nResponse:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error calling cron:', error.message);
    console.log('\nMake sure dev server is running: npm run dev');
  }
}

main().catch(console.error);
