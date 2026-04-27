/**
 * Address Validation API
 *
 * Lightweight endpoint for real-time address validation during signup.
 * Returns validation status, ward/section, and helpful error messages.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';
import { geocodeChicagoAddress } from '../../lib/places-geocoder';

// Main DB (has 2026 schedule + PostGIS functions). Legacy MSC left one endpoint
// returning null cleaning dates on the web + mobile check-your-street flow.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const mscSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// Geocode address with caching. Backed by the shared Places API
// autocomplete+details pipeline (lib/places-geocoder.ts) so signups for
// Chicago grid addresses land on the correct ward+section.
async function geocodeAddress(address: string): Promise<{
  success: boolean;
  coordinates?: { lat: number; lng: number };
  formattedAddress?: string;
  error?: string;
}> {
  const cacheKey = address.toLowerCase().trim();

  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const geo = await geocodeChicagoAddress(address);

  if (geo.status === 'NOT_CHICAGO') {
    const result = {
      success: false,
      error: `This address appears to be in ${geo.city || 'another city'}, not Chicago. Our service currently only covers Chicago.`,
    };
    geocodeCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  if (geo.status !== 'OK' || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') {
    let errorMessage = 'Unable to verify address. Please try again.';
    if (geo.status === 'ZERO_RESULTS') {
      errorMessage = 'Address not found. Please check the spelling and try again.';
    } else if (geo.status === 'ERROR') {
      errorMessage = 'Address verification service temporarily unavailable. Please try again later.';
    }
    const result = { success: false, error: errorMessage };
    geocodeCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  const result = {
    success: true,
    coordinates: { lat: geo.lat, lng: geo.lng },
    formattedAddress: geo.formattedAddress,
  };
  geocodeCache.set(cacheKey, { result, timestamp: Date.now() });
  return result;
}

// Look up ward/section from coordinates
async function lookupWardSection(lat: number, lng: number): Promise<{
  found: boolean;
  ward?: number;
  section?: string;
}> {
  // Check if MSC Supabase is configured
  if (!process.env.MSC_SUPABASE_ANON_KEY) {
    console.warn('MSC_SUPABASE_ANON_KEY not configured - ward/section lookup unavailable');
    return { found: false };
  }

  try {
    const { data, error } = await mscSupabase.rpc('find_section_for_point', {
      lon: lng,
      lat: lat
    });

    if (error) {
      console.error('Ward/section lookup error:', error.message);
      return { found: false };
    }

    if (!data?.length) {
      console.log(`No ward/section found for coordinates (${lat}, ${lng})`);
      return { found: false };
    }

    return {
      found: true,
      ward: data[0].ward,
      section: data[0].section
    };
  } catch (err) {
    console.error('Ward/section lookup exception:', err);
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

  // Rate limit: Google Maps geocoding costs money
  const ip = getClientIP(req);
  const rateResult = await checkRateLimit(ip, 'geocoding');
  if (!rateResult.allowed) {
    res.setHeader('X-RateLimit-Limit', rateResult.limit);
    res.setHeader('X-RateLimit-Remaining', rateResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + rateResult.resetIn / 1000));
    return res.status(429).json({ valid: false, message: 'Too many requests. Please try again later.' });
  }
  await recordRateLimitAction(ip, 'geocoding');

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
