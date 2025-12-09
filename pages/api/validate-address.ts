/**
 * Address Validation API
 *
 * Lightweight endpoint for real-time address validation during signup.
 * Returns validation status, ward/section, and helpful error messages.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// MyStreetCleaning database for PostGIS queries
const MSC_SUPABASE_URL = process.env.MSC_SUPABASE_URL || 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_SUPABASE_ANON_KEY = process.env.MSC_SUPABASE_ANON_KEY || '';

const mscSupabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_ANON_KEY);

// Cache for recent geocoding results (5 minute TTL)
const geocodeCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ValidationResult {
  valid: boolean;
  ward?: number;
  section?: string;
  coordinates?: { lat: number; lng: number };
  message?: string;
  suggestion?: string;
}

// Basic address format validation (before hitting Google API)
function validateAddressFormat(address: string): { valid: boolean; message?: string } {
  const trimmed = address.trim();

  // Minimum length
  if (trimmed.length < 5) {
    return { valid: false, message: 'Address is too short. Please enter a complete street address.' };
  }

  // Must contain a number (street number)
  if (!/\d/.test(trimmed)) {
    return { valid: false, message: 'Please include a street number (e.g., "123 Main St").' };
  }

  // Must contain letters (street name)
  if (!/[a-zA-Z]/.test(trimmed)) {
    return { valid: false, message: 'Please include a street name.' };
  }

  // Common Chicago-specific validation
  const lowerAddress = trimmed.toLowerCase();

  // Check for Chicago indicators
  const hasChicagoIndicator =
    lowerAddress.includes('chicago') ||
    lowerAddress.includes('il') ||
    lowerAddress.includes('illinois') ||
    /606\d{2}/.test(lowerAddress); // 606xx ZIP codes

  if (!hasChicagoIndicator) {
    // Not an error, but we'll add Chicago context when geocoding
  }

  return { valid: true };
}

// Geocode address with caching
async function geocodeAddress(address: string): Promise<{
  success: boolean;
  coordinates?: { lat: number; lng: number };
  formattedAddress?: string;
  error?: string;
}> {
  const cacheKey = address.toLowerCase().trim();

  // Check cache
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;
  if (!googleApiKey) {
    return { success: false, error: 'Geocoding service unavailable' };
  }

  // Always add Chicago context for better results
  const normalizedAddress = address.toLowerCase().includes('chicago')
    ? address
    : `${address}, Chicago, IL`;

  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalizedAddress)}&key=${googleApiKey}`;

  try {
    const response = await fetch(geocodeUrl);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results?.length) {
      const result = {
        success: false,
        error: data.status === 'ZERO_RESULTS'
          ? 'Address not found. Please check the spelling and try again.'
          : 'Unable to verify address. Please try again.'
      };
      geocodeCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const location = data.results[0];

    // Verify the address is in Chicago
    const isChicago = location.address_components.some((comp: any) =>
      comp.types.includes('locality') &&
      comp.long_name.toLowerCase() === 'chicago'
    );

    if (!isChicago) {
      const city = location.address_components.find((comp: any) =>
        comp.types.includes('locality')
      )?.long_name || 'this location';

      const result = {
        success: false,
        error: `This address appears to be in ${city}, not Chicago. Our service currently only covers Chicago.`
      };
      geocodeCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const result = {
      success: true,
      coordinates: {
        lat: location.geometry.location.lat,
        lng: location.geometry.location.lng
      },
      formattedAddress: location.formatted_address
    };

    geocodeCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    return { success: false, error: 'Unable to verify address. Please try again.' };
  }
}

// Look up ward/section from coordinates
async function lookupWardSection(lat: number, lng: number): Promise<{
  found: boolean;
  ward?: number;
  section?: string;
}> {
  try {
    const { data, error } = await mscSupabase.rpc('find_section_for_point', {
      lon: lng,
      lat: lat
    });

    if (error || !data?.length) {
      return { found: false };
    }

    return {
      found: true,
      ward: data[0].ward,
      section: data[0].section
    };
  } catch {
    return { found: false };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ValidationResult>
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ valid: false, message: 'Method not allowed' });
  }

  const address = req.method === 'GET'
    ? (req.query.address as string)
    : req.body?.address;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      valid: false,
      message: 'Please enter an address'
    });
  }

  // Step 1: Basic format validation
  const formatCheck = validateAddressFormat(address);
  if (!formatCheck.valid) {
    return res.status(200).json({
      valid: false,
      message: formatCheck.message,
      suggestion: 'Example: 123 N Michigan Ave, Chicago, IL 60601'
    });
  }

  // Step 2: Geocode the address
  const geocodeResult = await geocodeAddress(address);
  if (!geocodeResult.success) {
    return res.status(200).json({
      valid: false,
      message: geocodeResult.error,
      suggestion: 'Try including the full street name and "Chicago, IL"'
    });
  }

  // Step 3: Look up ward/section
  const { lat, lng } = geocodeResult.coordinates!;
  const wardSection = await lookupWardSection(lat, lng);

  if (!wardSection.found) {
    return res.status(200).json({
      valid: false,
      coordinates: { lat, lng },
      message: 'This address is valid but not in a street cleaning zone. It may be in a private area, park, or commercial district without regular street cleaning.',
      suggestion: 'If you believe this is incorrect, please contact support.'
    });
  }

  // Success!
  return res.status(200).json({
    valid: true,
    ward: wardSection.ward,
    section: wardSection.section,
    coordinates: { lat, lng },
    message: `Valid Chicago address in Ward ${wardSection.ward}, Section ${wardSection.section}`
  });
}
