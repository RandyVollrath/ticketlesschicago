import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '../../lib/supabase/client';

const supabase = createClient();

interface LookupResponse {
  ward?: string;
  section?: string;
  nextCleaningDate?: string;
  message?: string;
  error?: string;
}

// Geocode address using a free service
async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    // Using Nominatim (OpenStreetMap) for geocoding - free and no API key required
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?` +
      `format=json&q=${encodeURIComponent(address + ', Chicago, IL')}&limit=1`,
      {
        headers: {
          'User-Agent': 'TicketlessAmerica/1.0'
        }
      }
    );
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LookupResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ 
      error: 'Address parameter is required' 
    });
  }

  try {
    // First, geocode the address to get lat/lon
    const coords = await geocodeAddress(address);
    
    if (!coords) {
      return res.status(404).json({
        message: 'Could not locate address. Please enter a valid Chicago address.'
      });
    }

    // Use PostGIS function to find the ward/section
    const { data, error } = await supabase
      .rpc('find_section_for_point', {
        lon: coords.lon,
        lat: coords.lat
      });

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        error: 'Failed to lookup ward/section'
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        message: 'Address is not within Chicago street cleaning zones'
      });
    }

    const { ward, section } = data[0];

    // Get next cleaning date for this ward/section
    const { data: nextCleaning } = await supabase
      .rpc('get_next_cleaning_date', {
        p_ward: ward,
        p_section: section
      });

    return res.status(200).json({
      ward,
      section,
      nextCleaningDate: nextCleaning || null,
      message: `Found: Ward ${ward}, Section ${section}`
    });

  } catch (error) {
    console.error('Error in find-section:', error);
    return res.status(500).json({
      error: 'Failed to process address lookup'
    });
  }
}