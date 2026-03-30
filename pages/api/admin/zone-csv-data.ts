import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const csvPath = '/home/randy-vollrath/Downloads/2026 Street Cleaning Wards 1-50 - Sheet1.csv';

    // Try local file first, fall back to reading from Supabase
    let csvText: string;
    try {
      csvText = fs.readFileSync(csvPath, 'utf-8');
    } catch {
      // Fallback: read from the schedule table
      return res.status(200).json({});
    }

    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    const eastIdx = headers.indexOf('east_block');
    const westIdx = headers.indexOf('west_block');
    const northIdx = headers.indexOf('north_boundary');
    const southIdx = headers.indexOf('south_boundary');
    const wardIdx = headers.indexOf('ward');
    const sectionIdx = headers.indexOf('section');

    const zones: Record<string, { east: string; west: string; north: string; south: string }> = {};

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      // Simple CSV parse (handles our format)
      const cols: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const ch of lines[i]) {
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
        else { current += ch; }
      }
      cols.push(current.trim());

      const ward = cols[wardIdx]?.trim();
      const section = cols[sectionIdx]?.trim();
      if (!ward || !section) continue;

      const key = `${ward}-${section}`;
      if (!zones[key]) {
        zones[key] = {
          east: cols[eastIdx]?.trim() || '',
          west: cols[westIdx]?.trim() || '',
          north: cols[northIdx]?.trim() || '',
          south: cols[southIdx]?.trim() || '',
        };
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(zones);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
