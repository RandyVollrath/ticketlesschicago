// Script to geocode winter ban streets and store geometry in database
// Run this locally where the Geocoding API key works

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

async function geocodeAddress(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'OK' && data.results?.length > 0) {
    return data.results[0].geometry.location;
  }
  return null;
}

async function main() {
  console.log('Fetching winter ban streets...');

  const { data: streets, error } = await supabase
    .from('winter_overnight_parking_ban_streets')
    .select('id, street_name, from_location, to_location');

  if (error) {
    console.error('Error fetching streets:', error);
    return;
  }

  console.log(`Found ${streets.length} streets to geocode`);

  let successCount = 0;

  for (const street of streets) {
    console.log(`\nProcessing: ${street.street_name} from ${street.from_location} to ${street.to_location}`);

    const originAddress = `${street.from_location} and ${street.street_name}, Chicago, IL`;
    const destAddress = `${street.to_location} and ${street.street_name}, Chicago, IL`;

    const originLoc = await geocodeAddress(originAddress);
    await new Promise(r => setTimeout(r, 100)); // Rate limit
    const destLoc = await geocodeAddress(destAddress);

    if (originLoc && destLoc) {
      // Create GeoJSON LineString
      const geom = {
        type: 'LineString',
        coordinates: [
          [originLoc.lng, originLoc.lat],
          [destLoc.lng, destLoc.lat]
        ]
      };

      // Update database
      const { error: updateError } = await supabase
        .from('winter_overnight_parking_ban_streets')
        .update({ geom: geom })
        .eq('id', street.id);

      if (updateError) {
        console.error(`  Error updating ${street.street_name}:`, updateError);
      } else {
        console.log(`  ✓ Saved geometry: [${originLoc.lat.toFixed(4)}, ${originLoc.lng.toFixed(4)}] to [${destLoc.lat.toFixed(4)}, ${destLoc.lng.toFixed(4)}]`);
        successCount++;
      }
    } else {
      console.log(`  ✗ Could not geocode (origin: ${originLoc ? 'OK' : 'FAIL'}, dest: ${destLoc ? 'OK' : 'FAIL'})`);
    }

    await new Promise(r => setTimeout(r, 100)); // Rate limit
  }

  console.log(`\n=== Summary ===`);
  console.log(`Successfully geocoded: ${successCount}/${streets.length}`);
}

main().catch(console.error);
