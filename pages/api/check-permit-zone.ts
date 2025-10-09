import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { parseChicagoAddress } from '../../lib/address-parser';

export interface PermitZoneResult {
  hasPermitZone: boolean;
  zones: Array<{
    zone: string;
    status: string;
    addressRange: string;
    ward: string;
  }>;
  parsedAddress: {
    number: number;
    direction: string | null;
    name: string;
    type: string | null;
  } | null;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PermitZoneResult>
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: 'Method not allowed'
    });
  }

  // Get address from query or body
  const address = (req.method === 'GET'
    ? req.query.address
    : req.body?.address) as string;

  if (!address) {
    return res.status(400).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: 'Missing required parameter: address'
    });
  }

  try {
    // Parse the address
    const parsed = parseChicagoAddress(address);

    if (!parsed) {
      return res.status(400).json({
        hasPermitZone: false,
        zones: [],
        parsedAddress: null,
        error: 'Could not parse address. Please provide a valid Chicago address (e.g., "1710 S Clinton St")'
      });
    }

    console.log('Parsed address:', parsed);

    // Check database connection
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // Build query to find matching permit zones
    let query = supabaseAdmin
      .from('parking_permit_zones')
      .select('*')
      .eq('street_name', parsed.name)
      .eq('status', 'ACTIVE')
      .lte('address_range_low', parsed.number)
      .gte('address_range_high', parsed.number);

    // Filter by direction if present
    if (parsed.direction) {
      query = query.eq('street_direction', parsed.direction);
    }

    // Filter by street type if present
    if (parsed.type) {
      query = query.eq('street_type', parsed.type);
    }

    // Execute query
    const { data: zones, error: dbError } = await query;

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to query permit zones');
    }

    console.log(`Found ${zones?.length || 0} potential matches`);

    // Filter by odd/even if specified
    const matchingZones = zones?.filter(zone => {
      // If zone specifies odd/even, check if it matches
      if (zone.odd_even) {
        const oddEvenMatch = parsed.isOdd
          ? zone.odd_even === 'O'
          : zone.odd_even === 'E';
        return oddEvenMatch;
      }
      // If no odd/even specified, zone covers all addresses
      return true;
    }) || [];

    console.log(`After odd/even filter: ${matchingZones.length} matches`);

    // Format response
    const formattedZones = matchingZones.map(zone => ({
      zone: zone.zone,
      status: zone.status,
      addressRange: `${zone.address_range_low}-${zone.address_range_high} ${zone.street_direction || ''} ${zone.street_name} ${zone.street_type || ''}`.trim(),
      ward: zone.ward_low === zone.ward_high
        ? `Ward ${zone.ward_low}`
        : `Wards ${zone.ward_low}-${zone.ward_high}`
    }));

    return res.status(200).json({
      hasPermitZone: formattedZones.length > 0,
      zones: formattedZones,
      parsedAddress: {
        number: parsed.number,
        direction: parsed.direction,
        name: parsed.name,
        type: parsed.type
      }
    });

  } catch (error: any) {
    console.error('Error checking permit zone:', error);
    return res.status(500).json({
      hasPermitZone: false,
      zones: [],
      parsedAddress: null,
      error: error.message || 'Internal server error'
    });
  }
}
