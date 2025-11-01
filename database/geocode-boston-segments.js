#!/usr/bin/env node

/**
 * Geocode Boston street segments and save lat/lng to database
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GOOGLE_API_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function geocodeSegments() {
  console.log('📍 Fetching Boston street segments...');

  const { data: segments, error } = await supabase
    .from('boston_street_sweeping')
    .select('id, st_name, from_street, to_street, segment_lat, segment_lng')
    .is('segment_lat', null)
    .range(0, 10000); // Fetch up to 10000 rows (more than enough)

  if (error) {
    console.error('❌ Error fetching segments:', error);
    process.exit(1);
  }

  console.log(`📊 Found ${segments.length} segments to geocode`);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Skip if already geocoded
    if (segment.segment_lat && segment.segment_lng) {
      skippedCount++;
      continue;
    }

    try {
      // Build address: "Street Name between From Street and To Street, Boston, MA"
      const address = `${segment.st_name} between ${segment.from_street || 'start'} and ${segment.to_street || 'end'}, Boston, MA`;

      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
      const response = await fetch(geocodeUrl);
      const data = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;

        // Update segment with lat/lng
        const { error: updateError } = await supabase
          .from('boston_street_sweeping')
          .update({
            segment_lat: location.lat,
            segment_lng: location.lng
          })
          .eq('id', segment.id);

        if (updateError) {
          console.error(`❌ Error updating segment ${segment.id}:`, updateError);
          failCount++;
        } else {
          successCount++;
          console.log(`✅ [${i + 1}/${segments.length}] Geocoded "${address}" → ${location.lat}, ${location.lng}`);
        }
      } else {
        console.warn(`⚠️  [${i + 1}/${segments.length}] Failed to geocode "${address}": ${data.status}`);
        failCount++;
      }

      // Rate limit: Google allows 50 requests/second, so sleep 25ms between requests
      await new Promise(resolve => setTimeout(resolve, 25));

    } catch (err) {
      console.error(`❌ Error processing segment ${segment.id}:`, err.message);
      failCount++;
    }
  }

  console.log('\n📊 Geocoding Summary:');
  console.log(`✅ Successfully geocoded: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⏭️  Skipped (already geocoded): ${skippedCount}`);
}

geocodeSegments()
  .then(() => {
    console.log('✅ Geocoding complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
