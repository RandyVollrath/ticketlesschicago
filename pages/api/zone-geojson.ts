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

    // Override: any zone in zone_geometry_edits gets its geometry from that table
    // (these are explicit saves/confirms from the editor)
    // For all other zones, use Supabase schedule geom if it differs from static
    const editGeom = new Map<string, any>();
    try {
      const { data: editsData2 } = await supabase
        .from('zone_geometry_edits')
        .select('ward_section, geometry');
      for (const row of (editsData2 || [])) {
        if (row.geometry) editGeom.set(row.ward_section, row.geometry);
      }
    } catch {}

    let overrides = 0;
    for (const feature of geojson.features) {
      const ws = `${feature.properties.ward}-${feature.properties.section}`;

      // Priority 1: zone_geometry_edits table (explicit editor saves)
      const editG = editGeom.get(ws);
      if (editG) {
        feature.geometry = editG;
        feature.properties.source = 'manual_edit';
        overrides++;
        continue;
      }

      // Priority 2: confirmed flag (no geometry change but user approved)
      if (confirmedSet.has(ws)) {
        // Use Supabase schedule geom (might differ from static)
        const dbG = dbGeom.get(ws);
        if (dbG) feature.geometry = dbG;
        feature.properties.source = 'manual_edit';
        continue;
      }

      // Priority 3: Supabase schedule geom if different from static
      const dbG = dbGeom.get(ws);
      if (dbG) {
        const dbLen = JSON.stringify(dbG.coordinates).length;
        const stLen = JSON.stringify(feature.geometry?.coordinates).length;
        if (Math.abs(dbLen - stLen) > 10) {
          feature.geometry = dbG;
          feature.properties.source = 'manual_edit';
          overrides++;
        }
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
