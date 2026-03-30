import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Read boundary data from the street_cleaning_schedule table
    const zones: Record<string, { east: string; west: string; north: string; south: string }> = {};

    let allRows: any[] = [];
    let page = 0;
    while (true) {
      const { data } = await supabase
        .from('street_cleaning_schedule')
        .select('ward_section, ward, section, east_block, west_block, north_block, south_block')
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (!data || data.length === 0) break;
      allRows.push(...data);
      page++;
    }

    for (const row of allRows) {
      const key = row.ward_section || `${row.ward}-${row.section}`;
      if (!zones[key]) {
        zones[key] = {
          east: row.east_block || '',
          west: row.west_block || '',
          north: row.north_block || '',
          south: row.south_block || '',
        };
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(zones);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
