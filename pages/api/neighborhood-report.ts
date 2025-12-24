/**
 * Neighborhood Reality Report API
 *
 * Generates a personalized, address-level report about enforcement, risk, and
 * friction from city policies at a specific Chicago address.
 *
 * Usage:
 * GET /api/neighborhood-report?address=123+W+Main+St,+Chicago,+IL
 * GET /api/neighborhood-report?lat=41.8781&lng=-87.6298
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  generateNeighborhoodRealityReport,
  NeighborhoodRealityReport,
} from '../../lib/neighborhood-reality-report';

interface GeocodeResponse {
  results: Array<{
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
    formatted_address: string;
  }>;
  status: string;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('Google Maps API key not configured');
    return null;
  }

  try {
    const encodedAddress = encodeURIComponent(address);
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }

    const data: GeocodeResponse = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.warn('Geocoding returned no results:', data.status);
      return null;
    }

    const location = data.results[0].geometry.location;
    return { lat: location.lat, lng: location.lng };
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NeighborhoodRealityReport | { error: string }>
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let latitude: number | undefined;
    let longitude: number | undefined;

    // Check for lat/lng parameters
    if (req.query.lat && req.query.lng) {
      latitude = parseFloat(req.query.lat as string);
      longitude = parseFloat(req.query.lng as string);

      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ error: 'Invalid latitude or longitude' });
      }
    }
    // Check for address parameter
    else if (req.query.address) {
      const address = req.query.address as string;

      // Validate it looks like a Chicago address
      if (!address.toLowerCase().includes('chicago')) {
        // Append Chicago if not included
        const chicagoAddress = `${address}, Chicago, IL`;
        const coords = await geocodeAddress(chicagoAddress);
        if (coords) {
          latitude = coords.lat;
          longitude = coords.lng;
        }
      } else {
        const coords = await geocodeAddress(address);
        if (coords) {
          latitude = coords.lat;
          longitude = coords.lng;
        }
      }

      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Could not geocode address' });
      }

      // Validate coordinates are within Chicago bounds
      // Chicago roughly: 41.6-42.1 lat, -87.9 to -87.5 lng
      if (latitude < 41.6 || latitude > 42.1 || longitude < -87.95 || longitude > -87.5) {
        return res.status(400).json({ error: 'Address is not within Chicago city limits' });
      }
    } else {
      return res.status(400).json({
        error: 'Missing required parameters. Provide either address or lat/lng coordinates.',
      });
    }

    // Generate the report
    const report = await generateNeighborhoodRealityReport(latitude, longitude);

    // Set cache headers (cache for 1 hour)
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json(report);
  } catch (error) {
    console.error('Error generating neighborhood report:', error);
    return res.status(500).json({
      error: 'Failed to generate neighborhood report',
    });
  }
}
