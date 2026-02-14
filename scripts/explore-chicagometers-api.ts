#!/usr/bin/env tsx

/**
 * Explores the map.chicagometers.com API to understand how to fetch all terminals
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
  console.log('=== Exploring map.chicagometers.com /search endpoint ===\n');

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

  console.log('Session established successfully\n');

  // Test 1: Empty search (what does it return?)
  console.log('1. Testing empty search query...');
  const emptySearchResponse = await apiRequest('/search', { query: '' }, csrfToken, cookieString);
  if (emptySearchResponse.ok) {
    const data = await emptySearchResponse.json();
    console.log(`   Returned ${data.length} results`);
    console.log(`   Sample result:`, data[0]);
  } else {
    console.log(`   Status: ${emptySearchResponse.status}`);
  }

  // Test 2: Wildcard search (*)
  console.log('\n2. Testing wildcard search (*)...');
  const wildcardResponse = await apiRequest('/search', { query: '*' }, csrfToken, cookieString);
  if (wildcardResponse.ok) {
    const data = await wildcardResponse.json();
    console.log(`   Returned ${data.length} results`);
  } else {
    console.log(`   Status: ${wildcardResponse.status}`);
  }

  // Test 3: Common street names
  console.log('\n3. Testing search with common street name "Clark"...');
  const clarkResponse = await apiRequest('/search', { query: 'Clark' }, csrfToken, cookieString);
  if (clarkResponse.ok) {
    const data = await clarkResponse.json();
    console.log(`   Returned ${data.length} results`);
  } else {
    console.log(`   Status: ${clarkResponse.status}`);
  }

  // Test 4: Numeric search (terminal ID)
  console.log('\n4. Testing numeric terminal ID search...');
  const numericResponse = await apiRequest('/search', { query: '4941' }, csrfToken, cookieString);
  if (numericResponse.ok) {
    const data = await numericResponse.json();
    console.log(`   Returned ${data.length} results`);
    if (data.length > 0) {
      console.log(`   First result:`, data[0]);
    }
  } else {
    console.log(`   Status: ${numericResponse.status}`);
  }

  // Test 5: Check if there's a way to get ALL terminals
  console.log('\n5. Trying to fetch all terminals with different approaches...');

  // Try body variations
  const testCases = [
    { body: {}, label: 'Empty body' },
    { body: { limit: 10000 }, label: 'Large limit' },
    { body: { query: '', limit: 10000 }, label: 'Empty query + large limit' },
    { body: { lat: 41.8781, lng: -87.6298, radius: 50000 }, label: 'Geographic query (downtown Chicago)' },
  ];

  for (const testCase of testCases) {
    const response = await apiRequest('/search', testCase.body, csrfToken, cookieString);
    if (response.ok) {
      const data = await response.json();
      console.log(`   ${testCase.label}: ${data.length} results`);
    } else {
      console.log(`   ${testCase.label}: Status ${response.status}`);
    }
  }

  // Test 6: Try the /terminals endpoint with different parameters
  console.log('\n6. Testing /terminals endpoint with various parameters...');

  const terminalTestCases = [
    { body: {}, label: 'Empty body' },
    { body: { bounds: { north: 42, south: 41.5, east: -87, west: -88 } }, label: 'Bounds for Chicago' },
    { body: { limit: 10000 }, label: 'Large limit' },
    { body: { all: true }, label: 'all: true' },
  ];

  for (const testCase of terminalTestCases) {
    const response = await apiRequest('/terminals', testCase.body, csrfToken, cookieString);
    if (response.ok) {
      try {
        const data = await response.json();
        console.log(`   ${testCase.label}: Success with ${Array.isArray(data) ? data.length : '?'} results`);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`     Sample:`, data[0]);
        }
      } catch (e) {
        console.log(`   ${testCase.label}: Response is not JSON`);
      }
    } else {
      const errorText = await response.text();
      console.log(`   ${testCase.label}: Status ${response.status} - ${errorText.substring(0, 100)}`);
    }
  }

  // Test 7: Download the app.js to see how the frontend fetches data
  console.log('\n7. Analyzing app.js for API usage patterns...');
  const appJsResponse = await fetch('https://map.chicagometers.com/js/app.js');
  const appJsContent = await appJsResponse.text();

  // Look for API endpoint usage
  const apiPatterns = [
    /fetch\(['"](\/[^'"]+)['"]/g,
    /axios\.post\(['"](\/[^'"]+)['"]/g,
    /\.post\(['"](\/[^'"]+)['"]/g,
    /"(\/terminals|\/search|\/place)"/g,
  ];

  console.log('   Searching for API endpoints in app.js...');
  const foundEndpoints = new Set<string>();

  for (const pattern of apiPatterns) {
    let match;
    while ((match = pattern.exec(appJsContent)) !== null) {
      foundEndpoints.add(match[1]);
    }
  }

  if (foundEndpoints.size > 0) {
    console.log('   Found endpoints:');
    foundEndpoints.forEach(endpoint => console.log(`     - ${endpoint}`));
  }

  // Look for how bounds/parameters are constructed
  console.log('\n   Looking for parameter construction patterns...');
  const boundsMatch = appJsContent.match(/bounds.*?{[^}]+}/);
  if (boundsMatch) {
    console.log('   Found bounds construction:', boundsMatch[0].substring(0, 200));
  }

  // Look for limit/pagination
  const limitMatch = appJsContent.match(/limit.*?[:=]\s*\d+/);
  if (limitMatch) {
    console.log('   Found limit pattern:', limitMatch[0]);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log('The /search endpoint is the working endpoint for querying meter terminals.');
  console.log('It accepts a "query" parameter (street name, terminal ID, area) and returns matching terminals.');
  console.log('Each terminal includes: TerminalID, address, lat/lng, rate info, time limits, and number of spaces.');
  console.log('\nThe /terminals and /place endpoints return 500 errors with simple requests.');
  console.log('Further investigation of app.js may reveal the correct parameters for these endpoints.');
}

main().catch(console.error);
