import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Serves zone GeoJSON from Supabase (live data including manual edits)
 * with fallback to static file. This ensures manual edits from the
 * zone editor take effect immediately without redeploying.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Load static GeoJSON as base
    const geojsonPath = path.join(process.cwd(), 'public', 'data', 'street-cleaning-zones-2026.geojson');
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    // Load ALL zone geometries from Supabase
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

    // Dedupe by ward_section
    const dbGeom = new Map<string, any>();
    for (const row of allRows) {
      if (!dbGeom.has(row.ward_section) && row.geom) {
        dbGeom.set(row.ward_section, row.geom);
      }
    }

    // Load confirmed/edited zones from zone_geometry_edits table
    const confirmedSet = new Set<string>();
    try {
      const { data: editsData } = await supabase
        .from('zone_geometry_edits')
        .select('ward_section, confirmed');
      for (const row of (editsData || [])) {
        if (row.confirmed) confirmedSet.add(row.ward_section);
      }
    } catch {}

    // Override static geometry with Supabase geometry where different
    let overrides = 0;
    for (const feature of geojson.features) {
      const ws = `${feature.properties.ward}-${feature.properties.section}`;
      const dbG = dbGeom.get(ws);
      if (dbG) {
        const dbFirst = JSON.stringify(dbG.coordinates?.[0]?.[0]?.[0]);
        const stFirst = JSON.stringify(feature.geometry?.coordinates?.[0]?.[0]?.[0]);
        if (dbFirst !== stFirst) {
          feature.geometry = dbG;
          feature.properties.source = 'manual_edit';
          overrides++;
        }
      }
      // Mark confirmed zones
      if (confirmedSet.has(ws)) {
        feature.properties.source = 'manual_edit';
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(geojson);
  } catch (err: any) {
    // Fallback to static file
    try {
      const geojsonPath = path.join(process.cwd(), 'public', 'data', 'street-cleaning-zones-2026.geojson');
      const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(geojson);
    } catch {
      res.status(500).json({ error: err.message });
    }
  }
}
