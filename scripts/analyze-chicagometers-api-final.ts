#!/usr/bin/env tsx

/**
 * Final analysis: Try to get all Chicago meter terminals via creative search queries
 */

interface CookieJar {
  [key: string]: string;
}

async function fetchWithSession(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      ...options.headers,
    },
  });

  const cookies: CookieJar = {};
  const setCookieHeaders = response.headers.getSetCookie?.() || [];

  for (const header of setCookieHeaders) {
    const [cookiePart] = header.split(';');
    const [name, value] = cookiePart.split('=');
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  }

  return { response, cookies };
}

async function apiRequest(endpoint: string, body: any, csrfToken: string, cookieString: string) {
  const response = await fetch(`https://map.chicagometers.com${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    },
    body: JSON.stringify(body),
  });

  return response;
}

async function main() {
  console.log('=== Final Analysis: Getting All Chicago Meter Terminals ===\n');

  // Step 1: Get session and CSRF token
  const { response: homeResponse, cookies } = await fetchWithSession('https://map.chicagometers.com/');
  const html = await homeResponse.text();

  const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  const csrfToken = csrfMatch?.[1];

  if (!csrfToken || !cookies.laravel_session) {
    console.error('Failed to get CSRF token or session cookie');
    return;
  }

  const cookieString = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  console.log('Session established\n');

  // Key finding: The /search endpoint uses Algolia behind the scenes
  // It returns objectID values like "10934034000"
  // The response has _highlightResult which is Algolia's feature
  // It's limited to 5 results per query

  console.log('Key Findings:');
  console.log('- API uses Algolia search (notice objectID and _highlightResult in response)');
  console.log('- /search endpoint is limited to 5 results per query');
  console.log('- No obvious way to fetch ALL terminals at once');
  console.log('- Data structure per terminal:');
  console.log('  * TerminalID: unique ID (e.g., "494116")');
  console.log('  * LocationAddress: street address');
  console.log('  * Latitude/Longitude: GPS coordinates');
  console.log('  * RatePackageDescription: parking rules (e.g., "$2.50, Mon-Sat 8 AM-10 PM, 3 hr POS")');
  console.log('  * FullRate: hourly rate');
  console.log('  * POS: time limit in hours');
  console.log('  * NumberOfSpaces: how many meters at this location');
  console.log('  * CLZTerminal: "0" or "1" (not sure what this means)\n');

  // Strategy: Try geographic bounds queries to see if we can tile the city
  console.log('Testing geographic queries to get comprehensive coverage...\n');

  // Chicago bounding box (approximate)
  const chicagoBounds = {
    north: 42.023,
    south: 41.644,
    east: -87.524,
    west: -87.940,
  };

  // Divide into a grid
  const gridSize = 10; // 10x10 grid
  const latStep = (chicagoBounds.north - chicagoBounds.south) / gridSize;
  const lngStep = (chicagoBounds.east - chicagoBounds.west) / gridSize;

  const allTerminals = new Map<string, any>();
  let totalQueries = 0;

  console.log(`Dividing Chicago into ${gridSize}x${gridSize} grid...`);
  console.log(`Each cell is approximately ${(latStep * 69).toFixed(2)} miles tall by ${(lngStep * 54).toFixed(2)} miles wide\n`);

  // Sample a few grid cells to see if geographic queries work
  const sampleCells = [
    { lat: 41.8781, lng: -87.6298 }, // Downtown
    { lat: 41.95, lng: -87.65 }, // North side
    { lat: 41.75, lng: -87.60 }, // South side
  ];

  for (const cell of sampleCells) {
    totalQueries++;
    const searchResponse = await apiRequest(
      '/search',
      {
        query: '',
        aroundLatLng: `${cell.lat},${cell.lng}`,
        aroundRadius: 5000, // 5km radius
      },
      csrfToken,
      cookieString
    );

    if (searchResponse.ok) {
      const data = await searchResponse.json();
      console.log(`Cell (${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)}): ${data.length} results`);

      for (const result of data) {
        const terminal = result.terminal;
        if (!allTerminals.has(terminal.TerminalID)) {
          allTerminals.set(terminal.TerminalID, terminal);
        }
      }
    } else {
      console.log(`Cell (${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)}): Failed (${searchResponse.status})`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\nTotal queries: ${totalQueries}`);
  console.log(`Unique terminals found: ${allTerminals.size}`);

  if (allTerminals.size > 0) {
    console.log('\nSample terminal data:');
    const sample = Array.from(allTerminals.values())[0];
    console.log(JSON.stringify(sample, null, 2));
  }

  // The real solution: check if there's a bulk data export or API documentation
  console.log('\n=== Recommended Approach ===');
  console.log('1. The /search endpoint is Algolia-powered and limited to 5 results');
  console.log('2. Geographic queries do NOT appear to work (same results regardless of location)');
  console.log('3. Best approach: Find the Chicago Open Data portal meter dataset');
  console.log('4. City of Chicago likely publishes meter locations as open data CSV/JSON');
  console.log('5. Check: data.cityofchicago.org for "parking meters" or "meter locations"');
  console.log('\nWithout bulk API access, scraping via search is impractical (would need');
  console.log('thousands of queries to cover all terminals, and results are not geocoded).');
}

main().catch(console.error);
