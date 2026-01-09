/**
 * Property Tax Lookup API
 *
 * Look up a property by PIN or address and get assessment data
 * from Cook County Assessor's database.
 *
 * POST /api/property-tax/lookup
 * Body: { pin?: string, address?: string, city?: string }
 * Response: { property: NormalizedProperty } or { properties: NormalizedProperty[] }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  getPropertyByPin,
  searchPropertiesByAddress,
  normalizePin,
  formatPin,
  NormalizedProperty
} from '../../../lib/cook-county-api';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - 30 lookups per hour per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  try {
    const { pin, address, city = 'CHICAGO' } = req.body;

    // Validate input - need either PIN or address
    if (!pin && !address) {
      return res.status(400).json({
        error: 'Please provide either a PIN or address to look up'
      });
    }

    // If PIN provided, do direct lookup
    if (pin) {
      const normalizedPin = normalizePin(pin);

      // Validate PIN format (14 digits)
      if (normalizedPin.length !== 14 || !/^\d+$/.test(normalizedPin)) {
        return res.status(400).json({
          error: 'Invalid PIN format. Please enter a valid 14-digit Cook County PIN.'
        });
      }

      // Check cache first
      const { data: cached } = await supabase
        .from('property_tax_properties')
        .select('*')
        .eq('pin', normalizedPin)
        .order('assessment_year', { ascending: false })
        .limit(1)
        .single();

      // If cached and less than 24 hours old, return cached
      if (cached && cached.last_synced_at) {
        const cacheAge = Date.now() - new Date(cached.last_synced_at).getTime();
        if (cacheAge < 24 * 60 * 60 * 1000) { // 24 hours
          return res.status(200).json({
            property: mapCachedToProperty(cached),
            cached: true
          });
        }
      }

      // Fetch from Cook County API
      const property = await getPropertyByPin(normalizedPin);

      if (!property) {
        return res.status(404).json({
          error: 'Property not found. Please check the PIN and try again.'
        });
      }

      // Cache the result
      await cacheProperty(property);

      return res.status(200).json({
        property,
        cached: false
      });
    }

    // Address search
    if (address) {
      if (address.trim().length < 3) {
        return res.status(400).json({
          error: 'Please enter at least 3 characters for address search'
        });
      }

      const properties = await searchPropertiesByAddress(address, city, 10);

      if (properties.length === 0) {
        return res.status(404).json({
          error: 'No properties found matching that address. Try a different search.'
        });
      }

      // Cache all found properties
      for (const prop of properties) {
        await cacheProperty(prop);
      }

      return res.status(200).json({
        properties,
        count: properties.length
      });
    }

    return res.status(400).json({ error: 'Invalid request' });

  } catch (error) {
    console.error('Property lookup error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error details:', { message: errorMessage, stack: errorStack });

    // Check if it's a Cook County API error
    if (error instanceof Error && error.message.includes('SODA API')) {
      return res.status(503).json({
        error: 'Cook County data service is temporarily unavailable. Please try again later.'
      });
    }

    // Return more detail in non-production for debugging
    return res.status(500).json({
      error: 'An error occurred while looking up the property. Please try again.',
      ...(process.env.NODE_ENV !== 'production' && { detail: errorMessage })
    });
  }
}

/**
 * Cache a property in our database
 */
async function cacheProperty(property: NormalizedProperty): Promise<void> {
  try {
    await supabase
      .from('property_tax_properties')
      .upsert({
        pin: property.pin,
        pin_formatted: property.pinFormatted,
        address: property.address,
        city: property.city,
        zip_code: property.zipCode,
        township: property.township,
        township_code: property.townshipCode,
        property_class: property.propertyClass,
        property_class_description: property.propertyClassDescription,
        square_footage: property.squareFootage,
        lot_size: property.lotSize,
        year_built: property.yearBuilt,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        exterior_construction: property.exteriorConstruction,
        basement_type: property.basementType,
        garage_type: property.garageType,
        assessment_year: property.assessmentYear,
        current_assessed_value: property.assessedValue,
        current_market_value: property.marketValue,
        prior_assessed_value: property.priorAssessedValue,
        prior_market_value: property.priorMarketValue,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'pin,assessment_year'
      });
  } catch (error) {
    // Log but don't fail the request
    console.error('Error caching property:', error);
  }
}

/**
 * Map cached database record to NormalizedProperty
 */
function mapCachedToProperty(cached: any): NormalizedProperty {
  return {
    pin: cached.pin,
    pinFormatted: cached.pin_formatted || formatPin(cached.pin),
    address: cached.address || '',
    city: cached.city || 'CHICAGO',
    zipCode: cached.zip_code || '',
    township: cached.township || '',
    townshipCode: cached.township_code || '',
    neighborhood: '', // Not stored in cache
    propertyClass: cached.property_class || '',
    propertyClassDescription: cached.property_class_description || '',
    yearBuilt: cached.year_built,
    squareFootage: cached.square_footage,
    lotSize: cached.lot_size,
    bedrooms: cached.bedrooms,
    bathrooms: cached.bathrooms,
    exteriorConstruction: cached.exterior_construction,
    basementType: cached.basement_type,
    garageType: cached.garage_type,
    assessmentYear: cached.assessment_year,
    assessedValue: cached.current_assessed_value,
    marketValue: cached.current_market_value,
    priorAssessedValue: cached.prior_assessed_value,
    priorMarketValue: cached.prior_market_value,
  };
}
