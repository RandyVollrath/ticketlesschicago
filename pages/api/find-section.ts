import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

// MyStreetCleaning database for PostGIS queries (has the geospatial data)
const MSC_SUPABASE_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI5NjUwMjQsImV4cCI6MjA1ODU0MTAyNH0.AwJc5gnerC8Dymk9uHVfHs_-orb297zxnVzY7lhWIS0';

const mscSupabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_ANON_KEY);

// Enhanced geocoding function with retry logic and better error handling
async function geocodeAddress(address: string, retryCount = 0): Promise<{ status: string; coordinates: { lat: number; lng: number }; retries?: number }> {
  const googleApiKey = process.env.GOOGLE_API_KEY;
  
  if (!googleApiKey) {
    console.error('❌ Google API key not configured');
    throw new Error('Google API key not configured');
  }
  
  console.log('🔑 Google API key configured:', googleApiKey ? 'YES' : 'NO');
  console.log('🔑 API key preview:', googleApiKey ? `${googleApiKey.slice(0, 8)}...` : 'NONE');

  // Normalize the address for better geocoding success
  const normalizedAddress = `${address}, Chicago, IL, USA`;
  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalizedAddress)}&key=${googleApiKey}`;
  
  console.log(`🔍 Geocoding address (attempt ${retryCount + 1}):`, normalizedAddress);
  console.log('🌐 Geocoding URL:', geocodeUrl.replace(googleApiKey, '[API_KEY_HIDDEN]'));
  
  try {
    const geocodeResponse = await fetch(geocodeUrl);
    
    if (!geocodeResponse.ok) {
      throw new Error(`Geocoding API returned ${geocodeResponse.status}`);
    }
    
    const geocodeData = await geocodeResponse.json();
    console.log('🔍 Geocoding response status:', geocodeData.status);
    
    if (geocodeData.error_message) {
      console.error('❌ Google API Error:', geocodeData.error_message);
    }

    // Handle rate limiting
    if (geocodeData.status === 'OVER_QUERY_LIMIT' && retryCount < 2) {
      console.log('⏰ Rate limited, retrying in 1 second...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return geocodeAddress(address, retryCount + 1);
    }

    // Handle temporary failures
    if (geocodeData.status === 'UNKNOWN_ERROR' && retryCount < 1) {
      console.log('❓ Unknown error, retrying...');
      await new Promise(resolve => setTimeout(resolve, 500));
      return geocodeAddress(address, retryCount + 1);
    }

    if (geocodeData.status !== 'OK' || !geocodeData.results.length) {
      return { 
        status: geocodeData.status, 
        coordinates: { lat: 0, lng: 0 },
        retries: retryCount
      };
    }

    const result = geocodeData.results[0];
    
    // Validate that the result is actually in Chicago
    const isInChicago = result.address_components.some((component: any) => 
      component.types.includes('locality') && 
      component.long_name.toLowerCase().includes('chicago')
    );
    
    if (!isInChicago) {
      console.log('⚠️ Geocoded address is not in Chicago');
      return {
        status: 'ZERO_RESULTS',
        coordinates: { lat: 0, lng: 0 },
        retries: retryCount
      };
    }
    
    return {
      status: geocodeData.status,
      coordinates: { lat: result.geometry.location.lat, lng: result.geometry.location.lng },
      retries: retryCount
    };
    
  } catch (error: any) {
    console.error('🚨 Geocoding fetch error:', error.message);
    
    // Retry on network errors
    if (retryCount < 2) {
      console.log(`🔄 Retrying geocoding due to network error (attempt ${retryCount + 2})...`);
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
        message: 'Please enter a valid Chicago street address with a street number and name.'
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
        error: 'Geocoding failed',
        details: {
          error_message: error.message,
          address: address
        }
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
    
    // Retry database operations up to 3 times
    for (let dbRetry = 0; dbRetry < 3; dbRetry++) {
      try {
        const result = await mscSupabase.rpc('find_section_for_point', {
          lon: coordinates.lng,
          lat: coordinates.lat
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
        const result = await mscSupabase
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

    // If PostGIS function didn't find a match, the address is in a gap or boundary area
    if (!foundWard || !foundSection) {
      console.log('❌ No exact match found - address appears to be in a gap or boundary area');
      
      // We have complete coverage of all 50 Chicago wards
      const wardCoverage = 'all 50 Chicago wards';
      
      console.log('No match found:', searchValue, coordinates);
      
      return res.status(404).json({ 
        error: 'Street cleaning information not available for this location',
        message: `No street cleaning schedule found for this location. This could mean the address is in an area where street cleaning doesn't apply (such as private property, parks, or certain downtown areas), is located in a boundary area between sections, or is outside our coverage area. Our database covers ${wardCoverage} with detailed section boundaries.`,
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
    const todayStr = new Date().toISOString().split('T')[0];
    let scheduleEntries = null;
    let scheduleError = null;
    let datesInRange = null;
    
    // Determine if this is a date range request
    const isDateRangeRequest = startDate && endDate;
    
    for (let schedRetry = 0; schedRetry < 2; schedRetry++) {
      if (isDateRangeRequest) {
        // Date range query for trip feature
        const result = await mscSupabase
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
        // Single next cleaning date query (default behavior)
        const result = await mscSupabase
          .from('street_cleaning_schedule')
          .select('cleaning_date')
          .eq('ward', foundWard)
          .eq('section', foundSection)
          .gte('cleaning_date', todayStr)
          .order('cleaning_date', { ascending: true })
          .limit(1);
          
        scheduleEntries = result.data;
        scheduleError = result.error;
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
        error: 'Failed to get cleaning schedule',
        details: {
          database_error: scheduleError.message,
          ward: foundWard,
          section: foundSection
        }
      });
    }

    const nextCleaningDate = scheduleEntries && scheduleEntries.length > 0 
      ? scheduleEntries[0].cleaning_date 
      : null;

    console.log('Location search successful:', foundWard, foundSection, nextCleaningDate);

    // Build response object
    const responseData: any = {
      ward: foundWard,
      section: foundSection,
      nextCleaningDate: nextCleaningDate,
      coordinates: coordinates,
      geometry: foundGeometry,
      matchType: matchType,
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
      error: 'Internal server error',
      details: {
        error_message: error.message
      }
    });
  }
}