#!/usr/bin/env node

// Backfill vehicles rows for users who have a license_plate in user_profiles
// but no row in the vehicles table. The Autopilot signup path used to skip
// this insert, so paid users were invisible to admin endpoints that read
// from `vehicles`.

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, license_plate, license_state, vin, vehicle_year, vehicle_make, vehicle_model, zip_code, mailing_address, mailing_city, mailing_state, mailing_zip, is_paid, has_contesting, stripe_subscription_id')
    .not('license_plate', 'is', null);

  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }

  console.log(`Found ${profiles.length} profiles with a license plate`);
  let inserted = 0;
  let skipped = 0;

  for (const p of profiles) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('user_id', p.user_id)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const row = {
      user_id: p.user_id,
      license_plate: p.license_plate,
      vin: p.vin || null,
      year: p.vehicle_year || null,
      make: p.vehicle_make || null,
      model: p.vehicle_model || null,
      zip_code: p.zip_code || p.mailing_zip || null,
      mailing_address: p.mailing_address || null,
      mailing_city: p.mailing_city || 'Chicago',
      mailing_state: p.mailing_state || p.license_state || 'IL',
      mailing_zip: p.mailing_zip || p.zip_code || null,
      subscription_id: p.stripe_subscription_id || 'autopilot_backfill',
      subscription_status: p.is_paid ? 'active' : 'free',
    };

    if (DRY_RUN) {
      console.log(`[DRY-RUN] would insert: ${p.email} | plate=${p.license_plate}`);
      inserted++;
      continue;
    }

    const { error: insertError } = await supabase.from('vehicles').insert([row]);
    if (insertError) {
      console.error(`❌ Failed for ${p.email}:`, insertError.message);
    } else {
      console.log(`✅ Inserted vehicle for ${p.email} | plate=${p.license_plate}`);
      inserted++;
    }
  }

  console.log(`\nDone. inserted=${inserted} skipped=${skipped} total=${profiles.length}`);
})();
