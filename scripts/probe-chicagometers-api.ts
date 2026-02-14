#!/usr/bin/env tsx

/**
 * Probes the map.chicagometers.com API to understand its structure
 */

import * as cheerio from 'cheerio';

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

async function main() {
  console.log('=== Probing map.chicagometers.com API ===\n');

  // Step 1: Get the homepage to establish session and extract CSRF token
  console.log('1. Fetching homepage to get session...');
  const { response: homeResponse, cookies } = await fetchWithSession('https://map.chicagometers.com/');
  const html = await homeResponse.text();

  // Extract CSRF token
  const $ = cheerio.load(html);
  const csrfToken = $('meta[name="csrf-token"]').attr('content');

  console.log(`   Session cookie: ${cookies.laravel_session?.substring(0, 50)}...`);
  console.log(`   CSRF token: ${csrfToken}\n`);

  if (!csrfToken || !cookies.laravel_session) {
    console.error('Failed to get CSRF token or session cookie');
    return;
  }

  // Build cookie string
  const cookieString = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  // Step 2: Try the /terminals endpoint
  console.log('2. Testing POST /terminals endpoint...');
  try {
    const terminalsResponse = await fetch('https://map.chicagometers.com/terminals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      body: JSON.stringify({}),
    });

    console.log(`   Status: ${terminalsResponse.status}`);
    const terminalsData = await terminalsResponse.text();
    console.log(`   Response preview: ${terminalsData.substring(0, 500)}\n`);

    if (terminalsResponse.ok) {
      console.log('   Full response:');
      console.log(JSON.stringify(JSON.parse(terminalsData), null, 2));
    }
  } catch (err) {
    console.error(`   Error: ${err}`);
  }

  // Step 3: Try the /search endpoint
  console.log('\n3. Testing POST /search endpoint...');
  try {
    const searchResponse = await fetch('https://map.chicagometers.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ query: 'downtown' }),
    });

    console.log(`   Status: ${searchResponse.status}`);
    const searchData = await searchResponse.text();
    console.log(`   Response preview: ${searchData.substring(0, 500)}\n`);

    if (searchResponse.ok) {
      console.log('   Full response:');
      console.log(JSON.stringify(JSON.parse(searchData), null, 2));
    }
  } catch (err) {
    console.error(`   Error: ${err}`);
  }

  // Step 4: Try the /place endpoint
  console.log('\n4. Testing POST /place endpoint...');
  try {
    const placeResponse = await fetch('https://map.chicagometers.com/place', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ lat: 41.8781, lng: -87.6298 }), // Chicago coordinates
    });

    console.log(`   Status: ${placeResponse.status}`);
    const placeData = await placeResponse.text();
    console.log(`   Response preview: ${placeData.substring(0, 500)}\n`);

    if (placeResponse.ok) {
      console.log('   Full response:');
      console.log(JSON.stringify(JSON.parse(placeData), null, 2));
    }
  } catch (err) {
    console.error(`   Error: ${err}`);
  }

  // Step 5: Check the page source for JavaScript clues
  console.log('\n5. Analyzing page source for API clues...');

  // Look for app.js or main.js script tags
  const scriptTags = $('script[src]');
  console.log(`   Found ${scriptTags.length} script tags:`);
  scriptTags.each((i, elem) => {
    const src = $(elem).attr('src');
    if (src?.includes('app') || src?.includes('main') || src?.includes('js')) {
      console.log(`     - ${src}`);
    }
  });

  // Look for inline scripts that might contain API calls
  const inlineScripts = $('script:not([src])');
  console.log(`\n   Checking ${inlineScripts.length} inline scripts for API patterns...`);

  inlineScripts.each((i, elem) => {
    const scriptContent = $(elem).html() || '';

    // Look for fetch/axios calls or API endpoints
    if (scriptContent.includes('fetch') || scriptContent.includes('axios') || scriptContent.includes('/api/')) {
      console.log(`\n   Found API-related code in inline script ${i + 1}:`);
      // Extract relevant lines
      const lines = scriptContent.split('\n').filter(line =>
        line.includes('fetch') ||
        line.includes('axios') ||
        line.includes('/api/') ||
        line.includes('terminals') ||
        line.includes('search') ||
        line.includes('place')
      );
      lines.slice(0, 10).forEach(line => console.log(`     ${line.trim()}`));
    }
  });
}

main().catch(console.error);
