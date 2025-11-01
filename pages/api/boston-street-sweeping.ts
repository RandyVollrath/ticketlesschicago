import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * API endpoint to fetch Boston street sweeping schedules
 *
 * Query parameters:
 * - address: Address to search for street name
 * - street: Street name to search for
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address, street } = req.query;

  try {
    // Case 1: Fetch by street name
    if (street) {
      const { data, error } = await supabase
        .from('boston_street_sweeping')
        .select('*')
        .ilike('st_name', `%${street}%`)
        .order('st_name', { ascending: true })
        .limit(50);

      if (error) {
        console.error('Error fetching Boston streets by name:', error);
        return res.status(500).json({ error: 'Failed to fetch street data' });
      }

      return res.status(200).json({ schedules: data || [] });
    }

    // Case 2: Fetch by address (street name matching)
    if (address) {
      // Extract street name from address (simple approach)
      const streetName = (address as string).split(',')[0].trim();

      const { data, error } = await supabase
        .from('boston_street_sweeping')
        .select('*')
        .ilike('st_name', `%${streetName}%`)
        .limit(10);

      if (error) {
        console.error('Error fetching Boston streets by address:', error);
        return res.status(500).json({ error: 'Failed to fetch street data' });
      }

      return res.status(200).json({
        schedules: data || [],
        searchedStreet: streetName
      });
    }

    // No query parameters provided
    return res.status(400).json({ error: 'Missing required parameter: address or street' });

  } catch (err) {
    console.error('Unexpected error in Boston street sweeping API:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
