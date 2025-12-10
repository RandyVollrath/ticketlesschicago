/**
 * Migration Script: Copy MSC users to Autopilot America database
 *
 * This script migrates MyStreetCleaning users to the Autopilot America
 * user_profiles table so they receive street cleaning notifications.
 *
 * The script creates auth.users entries first (required by foreign key),
 * then creates user_profiles entries.
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-msc-to-aa.js   # Preview changes
 *   node scripts/migrate-msc-to-aa.js                 # Execute migration
 */

const { createClient } = require("@supabase/supabase-js");

// MSC Database credentials
const MSC_URL = "https://zqljxkqdgfibfzdjfjiq.supabase.co";
const MSC_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes";

// Load AA credentials from env
require('dotenv').config({ path: '.env.local' });
const AA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const AA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!AA_URL || !AA_KEY) {
  console.error("Error: Missing AA database credentials in .env.local");
  process.exit(1);
}

const msc = createClient(MSC_URL, MSC_KEY);
const aa = createClient(AA_URL, AA_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const DRY_RUN = process.env.DRY_RUN === 'true';

// Generate a random password for migrated users (they'll need to reset)
function generateRandomPassword() {
  return 'MSC_migrated_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function migrate() {
  console.log("=".repeat(60));
  console.log(DRY_RUN ? "🔍 DRY RUN MODE - No changes will be made" : "🚀 LIVE MIGRATION MODE");
  console.log("=".repeat(60));
  console.log();

  // Get all MSC users with valid addresses
  const { data: mscUsers, error: mscError } = await msc
    .from("user_profiles")
    .select("*")
    .not('home_address_ward', 'is', null)
    .not('home_address_section', 'is', null);

  if (mscError) {
    console.error("Failed to fetch MSC users:", mscError.message);
    return;
  }

  console.log(`Found ${mscUsers.length} MSC users with valid addresses`);

  // Get existing AA user emails to avoid duplicates
  const { data: aaUsers, error: aaError } = await aa
    .from("user_profiles")
    .select("email");

  if (aaError) {
    console.error("Failed to fetch AA users:", aaError.message);
    return;
  }

  const existingEmails = new Set(aaUsers.map(u => u.email.toLowerCase()));
  console.log(`Found ${aaUsers.length} existing AA users`);
  console.log();

  // Stats
  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  // Fields to copy from MSC to AA (user_id is generated from auth.users)
  const fieldsToCopy = [
    // 'user_id', -- will be set from auth.users creation
    'email',
    'home_address_full',
    'home_address_ward',
    'home_address_section',
    'notify_email',
    'notify_days_before',
    'notify_days_array',
    'phone_number',
    'notify_sms',
    'is_paid',
    'sms_pro',
    'sms_trial_expires_at',
    'follow_up_sms',
    'sms_pro_expires_at',
    'is_canary',
    'snooze_until_date',
    'phone_call_enabled',
    'notify_evening_before',
    'voice_calls_enabled',
    'voice_call_time',
    'phone_call_days_before',
  ];

  console.log("--- Migration Details ---");
  console.log();

  for (const mscUser of mscUsers) {
    const email = mscUser.email.toLowerCase();

    // Skip if already exists in AA
    if (existingEmails.has(email)) {
      console.log(`⏭️  SKIP: ${mscUser.email} (already in AA)`);
      skipped++;
      continue;
    }

    // Build the user record for AA
    const aaRecord = {
      role: 'msc_migrated', // Mark as migrated from MSC
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Copy relevant fields
    for (const field of fieldsToCopy) {
      if (mscUser[field] !== undefined && mscUser[field] !== null) {
        aaRecord[field] = mscUser[field];
      }
    }

    // Ensure required fields have sensible defaults
    if (!aaRecord.notify_email) aaRecord.notify_email = true;
    if (!aaRecord.notify_days_array) aaRecord.notify_days_array = [1]; // Default: 1 day before
    if (!aaRecord.notify_days_before) aaRecord.notify_days_before = 1;

    const wantsSms = mscUser.notify_sms && mscUser.phone_number;
    const wantsEmail = mscUser.notify_email !== false;

    console.log(`✅ MIGRATE: ${mscUser.email} | Ward ${mscUser.home_address_ward}, Sec ${mscUser.home_address_section} | Email:${wantsEmail} SMS:${wantsSms ? 'Yes' : 'No'}`);

    if (!DRY_RUN) {
      // Step 1: Create auth.users entry using admin API
      const { data: authData, error: authError } = await aa.auth.admin.createUser({
        email: mscUser.email,
        password: generateRandomPassword(),
        email_confirm: true, // Skip email confirmation for migrated users
        user_metadata: {
          migrated_from: 'mystreetcleaning',
          migrated_at: new Date().toISOString()
        }
      });

      if (authError) {
        // User might already exist in auth but not in user_profiles
        if (authError.message.includes('already been registered')) {
          console.log(`   ⚠️  Auth user exists, checking profile...`);
          // Try to get existing auth user
          const { data: existingUsers } = await aa.auth.admin.listUsers();
          const existingUser = existingUsers?.users?.find(u => u.email === mscUser.email);
          if (existingUser) {
            aaRecord.user_id = existingUser.id;
          } else {
            console.error(`   ❌ Could not find existing auth user: ${mscUser.email}`);
            errors++;
            continue;
          }
        } else {
          console.error(`   ❌ Error creating auth user: ${authError.message}`);
          errors++;
          continue;
        }
      } else {
        aaRecord.user_id = authData.user.id;
      }

      // Step 2: Insert user_profiles entry
      const { error: insertError } = await aa
        .from("user_profiles")
        .insert(aaRecord);

      if (insertError) {
        console.error(`   ❌ Error inserting profile: ${insertError.message}`);
        errors++;
        continue;
      }
    }

    migrated++;
  }

  console.log();
  console.log("=".repeat(60));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total MSC users with addresses: ${mscUsers.length}`);
  console.log(`Skipped (already in AA):        ${skipped}`);
  console.log(`Migrated:                       ${migrated}`);
  console.log(`Errors:                         ${errors}`);
  console.log();

  if (DRY_RUN) {
    console.log("This was a DRY RUN. To execute the migration, run:");
    console.log("  node scripts/migrate-msc-to-aa.js");
  } else {
    console.log("Migration complete!");
  }
}

migrate().catch(console.error);
