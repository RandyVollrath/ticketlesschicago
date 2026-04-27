import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseAdmin } from '../../lib/supabase';
import { isAddressOnSnowRoute } from '../../lib/snow-route-matcher';
import { isAddressOnWinterBan } from '../../lib/winter-ban-matcher';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import { getChicagoDateISO } from '../../lib/chicago-timezone-utils';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';

// Validate our ward lookup against Chicago Data Portal official ward boundaries API
// Fire-and-forget — logs mismatches but does not block or alter the response
async function validateWardAgainstCityApi(lat: number, lng: number, ourWard: string): Promise<void> {
  try {
    const url = `https://data.cityofchicago.org/resource/p293-wvbd.json?$where=intersects(the_geom,'POINT(${lng} ${lat})')&$select=ward&$limit=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.length > 0) {
      const cityWard = String(data[0].ward);
      if (cityWard !== ourWard) {
        console.warn(`🚨 WARD MISMATCH: Our PostGIS says Ward ${ourWard}, City API says Ward ${cityWard} for (${lat}, ${lng})`);
      }
    }
  } catch {
    // Silently ignore — this is a non-critical validation check
  }
}

// Enhanced geocoding function with retry logic and better error handling
// Geocode a typed address to lat/lng using the Places API (New) autocomplete
// + details two-step pipeline.
//
// Why not the legacy Maps Geocoding API: on Chicago grid streets like
// Fullerton, the legacy API interpolates along OSM-style segments and
// returns a midpoint that can be a full block (~1500 ft) east of the actual
// building. For "1237 W Fullerton Ave" it returned Sheffield/Fullerton
// (-87.6537), routing users into Ward 43 / Section 1 instead of the correct
// Ward 2 / Section 1 — they were getting the wrong cleaning schedule.
//
// Why not Places searchText either: it ALSO returns the wrong coordinate
// for that address. Google has two different Places at "1237 W Fullerton" —
// an interpolated one at -87.6537 (what searchText picks) and the actual
// building at -87.6599 (what autocomplete picks first, because autocomplete
// ranks established buildings ahead of interpolated points).
//
// So we do the same thing the website's AddressAutocomplete component does:
// autocomplete → first prediction → Place Details. Two upstream calls per
// geocode, sharing one session token so Google bills the pair as one search.
// Same return shape as before, so every caller of find-section is fixed:
// check-your-street v1+v2, stripe-webhook signups, StreetCleaningSettings
// home address, mobile CheckDestinationScreen, contest-letter generation.
async function geocodeAddress(address: string, retryCount = 0): Promise<{ status: string; coordinates: { lat: number; lng: number }; retries?: number }> {
  // Maps Platform key, separate from the Gemini key (Gemini service-account
  // keys can't hold Places API (New)).
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

  if (!googleApiKey) {
    console.error('❌ Google API key not configured');
    throw new Error('Google API key not configured');
  }

  const normalizedAddress = `${address}, Chicago, IL, USA`;
  // Per-request session token so Google bills the autocomplete + details
  // pair as one search.
  const sessionToken = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  console.log(`🔍 Places autocomplete (attempt ${retryCount + 1}):`, normalizedAddress);

  try {
    // Step 1 — autocomplete to find the best Place ID for this typed string.
    const acRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify({
        input: normalizedAddress,
        sessionToken,
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
        includedRegionCodes: ['us'],
        // Bias to Chicago — 50 km radius covers the city + nearby suburbs.
        locationBias: {
          circle: {
            center: { latitude: 41.8781, longitude: -87.6298 },
            radius: 50000,
          },
        },
      }),
    });

    if (!acRes.ok) {
      if ((acRes.status === 429 || acRes.status >= 500) && retryCount < 2) {
        console.log(`⏰ Autocomplete ${acRes.status}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return geocodeAddress(address, retryCount + 1);
      }
      const errBody = await acRes.text().catch(() => '');
      console.error('❌ Autocomplete error', acRes.status, errBody.slice(0, 300));
      return { status: 'ZERO_RESULTS', coordinates: { lat: 0, lng: 0 }, retries: retryCount };
    }

    const acData = await acRes.json();
    const suggestions = Array.isArray(acData?.suggestions) ? acData.suggestions : [];
    const placeId = suggestions[0]?.placePrediction?.placeId;
    const description = suggestions[0]?.placePrediction?.text?.text || '';

    if (!placeId) {
      console.log('🔍 No autocomplete predictions for:', normalizedAddress);
      return { status: 'ZERO_RESULTS', coordinates: { lat: 0, lng: 0 }, retries: retryCount };
    }

    // Step 2 — fetch precise location for that place_id.
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': googleApiKey,
          'X-Goog-FieldMask': 'location,formattedAddress,addressComponents',
        },
      },
    );

    if (!detailsRes.ok) {
      if ((detailsRes.status === 429 || detailsRes.status >= 500) && retryCount < 2) {
        console.log(`⏰ Details ${detailsRes.status}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return geocodeAddress(address, retryCount + 1);
      }
      const errBody = await detailsRes.text().catch(() => '');
      console.error('❌ Details error', detailsRes.status, errBody.slice(0, 300));
      return { status: 'ZERO_RESULTS', coordinates: { lat: 0, lng: 0 }, retries: retryCount };
    }

    const place = await detailsRes.json();
    const lat = place?.location?.latitude;
    const lng = place?.location?.longitude;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      console.log('🔍 Place Details has no usable location for:', description);
      return { status: 'ZERO_RESULTS', coordinates: { lat: 0, lng: 0 }, retries: retryCount };
    }

    // Verify the result is actually in Chicago (the locationBias is a hint,
    // not a hard filter — a typed "1237 Fullerton Boston" might still match).
    const comps: Array<{ longText: string; types: string[] }> = place.addressComponents || [];
    const isInChicago = comps.some(c =>
      c.types?.includes('locality') &&
      typeof c.longText === 'string' &&
      c.longText.toLowerCase().includes('chicago')
    );

    if (!isInChicago) {
      console.log('⚠️ Places result is not in Chicago:', place.formattedAddress);
      return { status: 'ZERO_RESULTS', coordinates: { lat: 0, lng: 0 }, retries: retryCount };
    }

    return {
      status: 'OK',
      coordinates: { lat, lng },
      retries: retryCount,
    };
  } catch (error: any) {
    console.error('🚨 Places API fetch error:', error?.message);

    if (retryCount < 2) {
      console.log(`🔄 Retrying Places API due to network error (attempt ${retryCount + 2})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return geocodeAddress(address, retryCount + 1);
    }

    throw error;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting — 100 requests per minute per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  const { address, lat, lng, mode, startDate, endDate, includeGeom } = req.query;

  if (!address && (!lat || !lng)) {
    return res.status(400).json({ error: 'Address or coordinates required' });
  }

  // Basic validation for minimum address requirements
  if (address && typeof address === 'string') {
    const addressStr = address.trim();
    
    // Only reject addresses that clearly don't meet minimum requirements
    if (addressStr.length < 3 || !/\d/.test(addressStr)) {
      return res.status(400).json({ 
        error: 'Invalid address format',
        message: 'Please enter a complete Chicago street address (e.g., "123 Main St" or "456 N Michigan Ave").'
      });
    }
  }

  let coordinates;
  let searchType = 'address';
  let searchValue = address as string;

  if (lat && lng) {
    coordinates = {
      lat: parseFloat(lat as string),
      lng: parseFloat(lng as string)
    };
    searchType = 'coordinates';
    searchValue = `${coordinates.lat},${coordinates.lng}`;
  } else {
    try {
      const geocodeResult = await geocodeAddress(address as string);
      if (geocodeResult.status !== 'OK') {
        console.error('❌ Geocoding failed:', geocodeResult.status);

        return res.status(404).json({ 
          error: 'Address not found',
          details: {
            geocoding_status: geocodeResult.status,
            address: address
          }
        });
      }

      coordinates = geocodeResult.coordinates;
      console.log('✅ Geocoding successful:', {
        address: address,
        coordinates: coordinates,
        status: geocodeResult.status
      });
    } catch (error: any) {
      console.error('❌ Geocoding error:', error);

      return res.status(500).json({
        error: 'Geocoding failed'
      });
    }
  }

  try {
    console.log('Starting location search:', searchType, searchValue);

    console.log('🔍 Searching for coordinates:', coordinates);

    // Try the PostGIS function for efficient lookup with retry logic
    console.log('🎯 Trying PostGIS function for coordinate lookup...');
    let postgisResult = null;
    let postgisError = null;

    // Use main DB (supabaseAdmin). The legacy MyStreetCleaning database didn't
    // have the 2026 schedule loaded, which made find-section return
    // nextCleaningDate: null for users whose cleaning IS scheduled.
    if (!supabaseAdmin) {
      console.error('❌ supabaseAdmin not configured — service role key missing');
      postgisError = { message: 'supabaseAdmin not configured' };
    } else {
      for (let dbRetry = 0; dbRetry < 3; dbRetry++) {
        try {
          const result = await (supabaseAdmin.rpc as any)('find_section_for_point', {
            lon: coordinates.lng,
            lat: coordinates.lat,
          });

          postgisResult = result.data;
          postgisError = result.error;

          if (!postgisError) {
            console.log(`✅ Database query successful on attempt ${dbRetry + 1}`);
            break;
          }

          if (dbRetry < 2) {
            console.log(`⚠️ Database error on attempt ${dbRetry + 1}, retrying:`, postgisError.message);
            await new Promise(resolve => setTimeout(resolve, 500 * (dbRetry + 1)));
          }
        } catch (dbError: any) {
          console.error(`🚨 Database exception on attempt ${dbRetry + 1}:`, dbError.message);
          postgisError = dbError;

          if (dbRetry < 2) {
            await new Promise(resolve => setTimeout(resolve, 500 * (dbRetry + 1)));
          }
        }
      }
    }

    let foundWard = null;
    let foundSection = null;
    let foundGeometry = null;
    let matchType = 'exact';

    if (postgisError) {
      console.warn('⚠️ PostGIS function error:', postgisError);
    } else if (postgisResult && postgisResult.length > 0) {
      console.log('✅ PostGIS function found result:', postgisResult[0]);
      foundWard = postgisResult[0].ward;
      foundSection = postgisResult[0].section;
      
      // Get the geometry for the found section with retry
      let geometryData = null;
      let geometryError = null;
      
      for (let geoRetry = 0; geoRetry < 2; geoRetry++) {
        const result = await supabaseAdmin!
          .from('street_cleaning_schedule')
          .select('geom_simplified')
          .eq('ward', foundWard)
          .eq('section', foundSection)
          .not('geom_simplified', 'is', null)
          .limit(1);
          
        geometryData = result.data;
        geometryError = result.error;
        
        if (!geometryError) break;
        
        if (geoRetry < 1) {
          console.log('Retrying geometry lookup...');
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      if (!geometryError && geometryData && geometryData.length > 0) {
        foundGeometry = geometryData[0].geom_simplified;
      }
    }

    // Fire-and-forget: validate ward against Chicago Data Portal official API
    if (foundWard && coordinates) {
      validateWardAgainstCityApi(coordinates.lat, coordinates.lng, foundWard).catch(() => {});
    }

    // If PostGIS function didn't find a match, the address is in a gap or boundary area
    if (!foundWard || !foundSection) {
      console.log('❌ No exact match found - address appears to be in a gap or boundary area');
      
      // We have complete coverage of all 50 Chicago wards
      const wardCoverage = 'all 50 Chicago wards';
      
      console.log('No match found:', searchValue, coordinates);
      
      // Return coordinates so the client can still show a map and check other restrictions
      // (permit zones, winter bans, snow routes, etc.) even without street cleaning data
      return res.status(404).json({
        error: 'Street cleaning information not available for this location',
        message: `No street cleaning schedule found for this location. This could mean the address is in an area where street cleaning doesn't apply (such as private property, parks, or certain downtown areas), is located in a boundary area between sections, or is outside our coverage area. Our database covers ${wardCoverage} with detailed section boundaries.`,
        coordinates: coordinates,
        address: searchValue,
        geocoding_successful: true,
        debug: {
          coordinates: coordinates,
          postgis_attempted: true,
          postgis_error: postgisError?.message || null,
          match_type: 'none',
          geocoding_successful: true,
          likely_reason: 'address_in_boundary_gap',
          ward_coverage: wardCoverage
        }
      });
    }

    console.log(`✅ Successfully found Ward ${foundWard}, Section ${foundSection} (${matchType} match)`);

    // Get cleaning dates (single or range based on parameters)
    const todayStr = getChicagoDateISO();
    let scheduleEntries = null;
    let scheduleError = null;
    let datesInRange = null;
    
    // Determine if this is a date range request
    const isDateRangeRequest = startDate && endDate;
    
    for (let schedRetry = 0; schedRetry < 2; schedRetry++) {
      if (isDateRangeRequest) {
        // Date range query for trip feature
        const result = await supabaseAdmin!
          .from('street_cleaning_schedule')
          .select('cleaning_date')
          .eq('ward', foundWard)
          .eq('section', foundSection)
          .gte('cleaning_date', startDate as string)
          .lte('cleaning_date', endDate as string)
          .order('cleaning_date', { ascending: true });
          
        scheduleEntries = result.data;
        scheduleError = result.error;
        datesInRange = scheduleEntries?.map(entry => entry.cleaning_date) || [];
      } else {
        // Fetch the next few upcoming cleanings so the UI can show both
        // "today" (if applicable) and the next distinct date after today.
        const result = await supabaseAdmin!
          .from('street_cleaning_schedule')
          .select('cleaning_date')
          .eq('ward', foundWard)
          .eq('section', foundSection)
          .gte('cleaning_date', todayStr)
          .order('cleaning_date', { ascending: true })
          .limit(5);

        scheduleEntries = result.data;
        scheduleError = result.error;

        console.log(`🔍 Schedule lookup for Ward ${foundWard}, Section ${foundSection}: upcoming =`, scheduleEntries?.map(e => e.cleaning_date).join(',') ?? 'none');
      }
      
      if (!scheduleError) {
        console.log(`✅ Schedule lookup successful on attempt ${schedRetry + 1}`);
        break;
      }
      
      if (schedRetry < 1) {
        console.log('Retrying schedule lookup...');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    if (scheduleError) {
      console.error('❌ Schedule lookup error:', scheduleError);

      return res.status(500).json({
        error: 'Failed to get cleaning schedule'
      });
    }

    const nextCleaningDate = scheduleEntries && scheduleEntries.length > 0
      ? scheduleEntries[0].cleaning_date
      : null;

    // For "Next: …" UX when today is already a cleaning day. Skip today and
    // any back-to-back cycle day so the next distinct upcoming cleaning lands
    // on a day the user cares about (e.g. Apr 17+20 → subsequent = Apr 20).
    const subsequentCleaningDate = scheduleEntries && scheduleEntries.length > 1
      ? scheduleEntries.map(e => e.cleaning_date).find(d => d > todayStr) || null
      : null;

    console.log('Location search successful:', foundWard, foundSection, nextCleaningDate, 'subsequent:', subsequentCleaningDate);

    // Check snow ban active status (single-row table, very fast)
    let snowBanActive = false;
    try {
      const { data: snowStatus } = await supabase
        .from('snow_route_status')
        .select('is_active')
        .eq('id', 1)
        .maybeSingle();
      snowBanActive = snowStatus?.is_active || false;
    } catch { /* non-critical */ }

    // Check if address is on a 2-inch snow ban route
    let snowRouteInfo = { isOnSnowRoute: false, route: null, streetName: null };
    let winterBanInfo = { isOnWinterBan: false, street: null, streetName: null };

    if (address && typeof address === 'string') {
      try {
        snowRouteInfo = await isAddressOnSnowRoute(address);
        console.log('Snow route check:', snowRouteInfo.isOnSnowRoute ? `ON ROUTE: ${snowRouteInfo.route?.on_street}` : 'Not on snow route');
      } catch (error) {
        console.error('Error checking snow route:', error);
        // Don't fail the whole request if snow route check fails
      }

      try {
        winterBanInfo = await isAddressOnWinterBan(address);
        console.log('Winter ban check:', winterBanInfo.isOnWinterBan ? `ON WINTER BAN: ${winterBanInfo.street?.street_name}` : 'Not on winter ban street');
      } catch (error) {
        console.error('Error checking winter ban:', error);
        // Don't fail the whole request if winter ban check fails
      }
    }

    // Build response object
    const responseData: any = {
      ward: foundWard,
      section: foundSection,
      nextCleaningDate: nextCleaningDate,
      subsequentCleaningDate: subsequentCleaningDate,
      upcomingCleaningDates: scheduleEntries?.map(e => e.cleaning_date) || [],
      coordinates: coordinates,
      geometry: foundGeometry,
      matchType: matchType,
      onSnowRoute: snowRouteInfo.isOnSnowRoute,
      snowRouteStreet: snowRouteInfo.route?.on_street || null,
      snowBanActive: snowBanActive,
      onWinterBan: winterBanInfo.isOnWinterBan,
      winterBanStreet: winterBanInfo.street?.street_name || null,
    };

    // Add date range specific fields if requested
    if (isDateRangeRequest) {
      responseData.datesInRange = datesInRange || [];

      // For trip feature, also find safe parking sections (sections with no cleaning during the period)
      // This is a simplified version - in a full implementation, you'd find nearby sections
      responseData.safeParkingSections = [];

      console.log(`📅 Date range query: Found ${datesInRange?.length || 0} cleaning dates between ${startDate} and ${endDate}`);
    }

    return res.status(200).json(responseData);

  } catch (error: any) {
    console.error('❌ API Error:', error);

    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}