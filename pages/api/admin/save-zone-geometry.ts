import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ward, section, geometry } = req.body;
    if (!ward || !section || !geometry) {
      return res.status(400).json({ error: 'Missing ward, section, or geometry' });
    }

    const zoneId = `chi-sc-${ward}-${section}`;
    const wardSection = `${ward}-${section}`;

    // 1. Update the GeoJSON file
    const geojsonPath = path.join(process.cwd(), 'public', 'data', 'street-cleaning-zones-2026.geojson');
    const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));

    let found = false;
    for (const feature of geojsonData.features) {
      if (feature.properties.id === zoneId) {
        feature.geometry = geometry;
        feature.properties.source = 'manual_edit';
        found = true;
        break;
      }
    }

    if (!found) {
      return res.status(404).json({ error: `Zone ${zoneId} not found` });
    }

    fs.writeFileSync(geojsonPath, JSON.stringify(geojsonData));

    // 2. Update Supabase
    const { error: dbError } = await supabase
      .from('street_cleaning_schedule')
      .update({ geom: geometry, geom_simplified: geometry })
      .eq('ward_section', wardSection);

    // Note: ward_section might not match exactly for all rows.
    // Also try ward + section separately
    if (dbError) {
      console.warn(`Supabase update warning for ${wardSection}:`, dbError.message);
      // Try updating by ward and section
      await supabase
        .from('street_cleaning_schedule')
        .update({ geom: geometry, geom_simplified: geometry })
        .eq('ward', ward)
        .eq('section', section);
    }

    res.status(200).json({ success: true, zone: zoneId });
  } catch (err: any) {
    console.error('Save zone error:', err);
    res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
