import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ward, section } = req.query;

  if (!ward || !section) {
    return res.status(400).json({ error: 'Ward and section are required' });
  }

  try {
    // Get all street cleaning dates for this ward/section
    const { data, error } = await supabase
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', ward)
      .eq('section', section)
      .order('cleaning_date', { ascending: true });

    if (error) {
      console.error('Error fetching cleaning schedule:', error);
      return res.status(500).json({ error: 'Failed to fetch cleaning schedule' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No cleaning schedule found for this ward/section' });
    }

    // Extract dates into array
    const allDates: string[] = data
      .map(row => row.cleaning_date)
      .filter(Boolean);

    return res.status(200).json({
      ward,
      section,
      cleaningDates: allDates
    });

  } catch (error: any) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
