const fs = require('fs');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const googleApiKey = process.env.GOOGLE_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

if (!googleApiKey) {
  console.error('Missing Google API key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Parse LA boundaries into 4 streets
// Format: "Jefferson Blvd to Coliseum St - Hauser Ave to Holdrege Ave"
// Returns: { north: "Coliseum St", south: "Jefferson Blvd", east: "Holdrege Ave", west: "Hauser Ave" }
function parseBoundaries(boundaryText) {
  const cleaned = boundaryText.trim();

  // Split by dash to get north-south and east-west
  const parts = cleaned.split('-').map(p => p.trim());

  if (parts.length !== 2) {
    console.warn('⚠️  Unexpected boundary format:', boundaryText);
    return null;
  }

  // Parse north-south (e.g., "Jefferson Blvd to Coliseum St")
  const nsMatch = parts[0].match(/(.+?)\s+to\s+(.+)/i);
  if (!nsMatch) {
    console.warn('⚠️  Could not parse north-south:', parts[0]);
    return null;
  }

  // Parse east-west (e.g., "Hauser Ave to Holdrege Ave")
  const ewMatch = parts[1].match(/(.+?)\s+to\s+(.+)/i);
  if (!ewMatch) {
    console.warn('⚠️  Could not parse east-west:', parts[1]);
    return null;
  }

  return {
    street1: nsMatch[1].trim(), // Jefferson Blvd
    street2: nsMatch[2].trim(), // Coliseum St
    street3: ewMatch[1].trim(), // Hauser Ave
    street4: ewMatch[2].trim()  // Holdrege Ave
  };
}

// Geocode an intersection with retry logic
async function geocodeIntersection(street1, street2, retries = 0) {
  const address = `${street1} & ${street2}, Los Angeles, CA`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OVER_QUERY_LIMIT') {
      if (retries < 3) {
        console.log(`⏰ Rate limited, waiting 2 seconds... (retry ${retries + 1}/3)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return geocodeIntersection(street1, street2, retries + 1);
      }
      throw new Error('Rate limit exceeded after retries');
    }

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }

    console.warn(`⚠️  Geocode failed for: ${address} (${data.status})`);
    return null;

  } catch (error) {
    console.error(`❌ Geocode error for ${address}:`, error.message);
    return null;
  }
}

// Create a polygon from 4 corner coordinates
function createPolygon(nw, ne, se, sw) {
  if (!nw || !ne || !se || !sw) {
    return null;
  }

  // PostGIS POLYGON format: POLYGON((lng lat, lng lat, lng lat, lng lat, lng lat))
  // Close the polygon by repeating the first point
  const wkt = `POLYGON((${sw.lng} ${sw.lat}, ${nw.lng} ${nw.lat}, ${ne.lng} ${ne.lat}, ${se.lng} ${se.lat}, ${sw.lng} ${sw.lat}))`;

  return wkt;
}

async function main() {
  console.log('📖 Reading LA street sweeping data...');

  const csvFilePath = '/tmp/la_street_sweeping.csv';
  const routes = [];

  // Read CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        routes.push({
          route_no: row['Route No'],
          council_district: row['Council District'],
          time_start: row['Time Start'],
          time_end: row['Time End'],
          boundaries: row['Boundaries']
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`✅ Read ${routes.length} routes`);

  // Group routes by unique boundaries to avoid duplicate geocoding
  const uniqueBoundaries = new Map();
  routes.forEach(route => {
    if (!uniqueBoundaries.has(route.boundaries)) {
      uniqueBoundaries.set(route.boundaries, []);
    }
    uniqueBoundaries.get(route.boundaries).push(route);
  });

  console.log(`📍 Found ${uniqueBoundaries.size} unique boundary combinations`);
  console.log(`💰 Estimated geocoding cost: $${(uniqueBoundaries.size * 4 * 0.005).toFixed(2)}`);
  console.log('🚀 Starting geocoding...\n');

  let processedBoundaries = 0;
  let successfulPolygons = 0;
  let failedPolygons = 0;

  for (const [boundaries, routesWithBoundary] of uniqueBoundaries) {
    processedBoundaries++;

    console.log(`\n[${processedBoundaries}/${uniqueBoundaries.size}] Processing: ${boundaries}`);

    const parsed = parseBoundaries(boundaries);
    if (!parsed) {
      console.error('❌ Failed to parse boundaries');
      failedPolygons++;
      continue;
    }

    console.log(`  Streets: ${parsed.street1} / ${parsed.street2} / ${parsed.street3} / ${parsed.street4}`);

    // Geocode 4 corners
    // NW: street2 & street3, NE: street2 & street4, SE: street1 & street4, SW: street1 & street3
    console.log('  🔍 Geocoding 4 corners...');

    const [nw, ne, se, sw] = await Promise.all([
      geocodeIntersection(parsed.street2, parsed.street3), // NW
      geocodeIntersection(parsed.street2, parsed.street4), // NE
      geocodeIntersection(parsed.street1, parsed.street4), // SE
      geocodeIntersection(parsed.street1, parsed.street3)  // SW
    ]);

    // Rate limiting: wait 250ms between batches of 4 geocode calls
    await new Promise(resolve => setTimeout(resolve, 250));

    if (!nw || !ne || !se || !sw) {
      console.error('  ❌ Failed to geocode all corners');
      failedPolygons++;
      continue;
    }

    console.log(`  ✅ All corners geocoded`);
    console.log(`     NW: (${nw.lat.toFixed(4)}, ${nw.lng.toFixed(4)})`);
    console.log(`     NE: (${ne.lat.toFixed(4)}, ${ne.lng.toFixed(4)})`);
    console.log(`     SE: (${se.lat.toFixed(4)}, ${se.lng.toFixed(4)})`);
    console.log(`     SW: (${sw.lat.toFixed(4)}, ${sw.lng.toFixed(4)})`);

    const polygon = createPolygon(nw, ne, se, sw);
    if (!polygon) {
      console.error('  ❌ Failed to create polygon');
      failedPolygons++;
      continue;
    }

    console.log(`  📐 Created polygon`);

    // Update all routes with this boundary
    for (const route of routesWithBoundary) {
      const dayOfWeek = route.route_no.match(/\s+(M|Tu|W|Th|F)$/)?.[1] || null;

      const { error } = await supabase
        .from('la_street_sweeping')
        .update({
          geom: polygon,
          day_of_week: dayOfWeek
        })
        .eq('route_no', route.route_no)
        .eq('boundaries', route.boundaries);

      if (error) {
        console.error(`  ❌ Failed to update route ${route.route_no}:`, error.message);
      }
    }

    console.log(`  ✅ Updated ${routesWithBoundary.length} route(s) with polygon`);
    successfulPolygons++;
  }

  console.log('\n========================================');
  console.log('🎉 GEOCODING COMPLETE');
  console.log('========================================');
  console.log(`✅ Successful polygons: ${successfulPolygons}`);
  console.log(`❌ Failed polygons: ${failedPolygons}`);
  console.log(`📊 Success rate: ${((successfulPolygons / uniqueBoundaries.size) * 100).toFixed(1)}%`);
  console.log('========================================');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
