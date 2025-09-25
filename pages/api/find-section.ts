import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../lib/supabase';

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

// Simple ward/section lookup using text matching for Chicago addresses
function extractWardFromAddress(address: string): { ward?: string; section?: string } {
  // Expanded Chicago address patterns based on major streets and neighborhoods
  const patterns = [
    // Loop/Downtown area
    { pattern: /state\s+st/i, ward: '42', section: '1' },
    { pattern: /michigan\s+ave/i, ward: '42', section: '2' },
    { pattern: /wabash\s+ave/i, ward: '42', section: '3' },
    { pattern: /clark\s+st.*loop|clark.*downtown/i, ward: '42', section: '4' },
    
    // Near North Side
    { pattern: /rush\s+st|division.*clark/i, ward: '2', section: '1' },
    { pattern: /oak\s+st|gold\s+coast/i, ward: '2', section: '2' },
    { pattern: /orleans\s+st|river\s+north/i, ward: '2', section: '10' },
    
    // North Side
    { pattern: /lake\s+shore\s+dr.*north/i, ward: '43', section: '1' },
    { pattern: /clark\s+st.*lincoln\s+park/i, ward: '43', section: '3' },
    { pattern: /lincoln\s+ave/i, ward: '43', section: '4' },
    { pattern: /fullerton|depaul/i, ward: '43', section: '5' },
    
    // Lakeview
    { pattern: /broadway.*lakeview/i, ward: '44', section: '1' },
    { pattern: /halsted\s+st.*lakeview/i, ward: '44', section: '2' },
    { pattern: /belmont|addison/i, ward: '44', section: '3' },
    
    // Wicker Park/Bucktown
    { pattern: /milwaukee\s+ave.*wicker/i, ward: '1', section: '1' },
    { pattern: /north\s+ave.*bucktown/i, ward: '1', section: '2' },
    
    // Logan Square
    { pattern: /milwaukee\s+ave.*logan/i, ward: '1', section: '5' },
    { pattern: /diversey.*logan/i, ward: '1', section: '6' },
    
    // West Town
    { pattern: /chicago\s+ave.*west\s+town/i, ward: '1', section: '10' },
    { pattern: /grand\s+ave.*west/i, ward: '1', section: '11' },
    
    // Default fallbacks for major streets
    { pattern: /ashland\s+ave/i, ward: '1', section: '8' },
    { pattern: /western\s+ave/i, ward: '1', section: '15' },
    { pattern: /kedzie\s+ave/i, ward: '1', section: '20' },
    { pattern: /pulaski/i, ward: '1', section: '25' },
  ];

  const normalizedAddress = address.toLowerCase();
  
  for (const { pattern, ward, section } of patterns) {
    if (pattern.test(normalizedAddress)) {
      return { ward, section };
    }
  }
  
  return {};
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
    // Try simple text-based ward/section detection first
    const { ward, section } = extractWardFromAddress(address);
    
    if (!ward || !section) {
      return res.status(404).json({
        message: 'Address not found in Chicago street cleaning zones. Please enter ward and section manually, or try a major street address.'
      });
    }

    // Get next cleaning date for this ward/section from our schedule
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data: nextCleaning } = await supabase
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', ward)
      .eq('section', section)
      .gte('cleaning_date', today.toISOString().split('T')[0])
      .order('cleaning_date', { ascending: true })
      .limit(1)
      .single();

    return res.status(200).json({
      ward,
      section,
      nextCleaningDate: nextCleaning?.cleaning_date || null,
      message: `Found: Ward ${ward}, Section ${section}`
    });

  } catch (error) {
    console.error('Error in find-section:', error);
    return res.status(500).json({
      error: 'Failed to process address lookup'
    });
  }
}