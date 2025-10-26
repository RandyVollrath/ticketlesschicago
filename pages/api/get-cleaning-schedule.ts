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
    // Get all street cleaning dates for this ward/section for the next year
    const { data, error } = await supabase
      .from('street_cleaning_schedule')
      .select('month, dates')
      .eq('ward', ward)
      .eq('section', section)
      .order('month', { ascending: true });

    if (error) {
      console.error('Error fetching cleaning schedule:', error);
      return res.status(500).json({ error: 'Failed to fetch cleaning schedule' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No cleaning schedule found for this ward/section' });
    }

    // Flatten all dates into a single array
    const allDates: string[] = [];
    data.forEach((monthData) => {
      if (monthData.dates && Array.isArray(monthData.dates)) {
        monthData.dates.forEach((dateStr: string) => {
          // Dates should be in YYYY-MM-DD format
          allDates.push(dateStr);
        });
      }
    });

    // Sort dates chronologically
    allDates.sort();

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
