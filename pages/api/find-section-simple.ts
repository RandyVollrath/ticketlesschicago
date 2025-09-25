import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../lib/supabase';

interface LookupResponse {
  ward?: string;
  section?: string;
  nextCleaningDate?: string;
  message?: string;
  error?: string;
}

// Simple ward/section lookup using text matching for Chicago addresses
// This is a basic implementation until PostGIS is enabled
function extractWardFromAddress(address: string): { ward?: string; section?: string } {
  // Basic Chicago address patterns - this would need to be expanded
  const patterns = [
    // Format: "123 N State St, Chicago, IL" -> Try to map to known areas
    { pattern: /state\s+st/i, ward: '42', section: '1' },
    { pattern: /michigan\s+ave/i, ward: '42', section: '2' },
    { pattern: /lake\s+shore\s+dr/i, ward: '43', section: '1' },
    { pattern: /clark\s+st/i, ward: '43', section: '3' },
    { pattern: /lincoln\s+ave/i, ward: '43', section: '4' },
    { pattern: /halsted\s+st/i, ward: '44', section: '2' },
    { pattern: /broadway/i, ward: '46', section: '1' },
    { pattern: /sheridan\s+rd/i, ward: '46', section: '2' },
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
    // Try simple text-based ward/section detection
    const { ward, section } = extractWardFromAddress(address);
    
    if (!ward || !section) {
      return res.status(404).json({
        message: 'Address not found. Please enter ward and section manually, or try a major street like "State St" or "Michigan Ave"'
      });
    }

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
      message: `Found: Ward ${ward}, Section ${section} (approximate)`
    });

  } catch (error) {
    console.error('Error in find-section:', error);
    return res.status(500).json({
      error: 'Failed to process address lookup'
    });
  }
}