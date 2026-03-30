import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Load static GeoJSON to compare against
    const geojsonPath = path.join(process.cwd(), 'public', 'data', 'street-cleaning-zones-2026.geojson');
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    const staticGeom: Record<string, string> = {};
    for (const f of geojson.features) {
      const ws = `${f.properties.ward}-${f.properties.section}`;
      // Use first coordinate as a fingerprint
      try {
        const c = f.geometry.coordinates[0]?.[0]?.[0];
        staticGeom[ws] = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
      } catch {
        staticGeom[ws] = '';
      }
    }

    // Get all zone geometries from Supabase
    const edits: Record<string, any> = {};
    let allRows: any[] = [];
    let page = 0;
    while (true) {
      const { data } = await supabase
        .from('street_cleaning_schedule')
        .select('ward_section, geom')
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (!data || data.length === 0) break;
      allRows.push(...data);
      page++;
    }

    const seen = new Set<string>();
    for (const row of allRows) {
      if (seen.has(row.ward_section)) continue;
      seen.add(row.ward_section);
      if (!row.geom?.coordinates) continue;

      // Compare first coordinate
      try {
        const c = row.geom.coordinates[0]?.[0]?.[0];
        const dbFingerprint = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
        const staticFingerprint = staticGeom[row.ward_section];

        if (staticFingerprint && dbFingerprint !== staticFingerprint) {
          edits[row.ward_section] = row.geom;
        }
      } catch {}
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(edits);
  } catch (err: any) {
    res.status(200).json({});
  }
}
