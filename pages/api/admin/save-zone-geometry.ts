import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Store edits in a Supabase table so they persist across deploys
// The zone editor reads from this table to overlay edits on the static GeoJSON

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Return all manual edits
    try {
      const { data, error } = await supabase
        .from('zone_geometry_edits')
        .select('ward_section, geometry');
      if (error) {
        // Table might not exist yet - return empty
        return res.status(200).json({});
      }
      const edits: Record<string, any> = {};
      for (const row of (data || [])) {
        edits[row.ward_section] = row.geometry;
      }
      return res.status(200).json(edits);
    } catch {
      return res.status(200).json({});
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ward, section, geometry, confirmed } = req.body;
    if (!ward || !section) {
      return res.status(400).json({ error: 'Missing ward or section' });
    }

    const wardSection = `${ward}-${section}`;

    if (geometry) {
      // Update geometry in street_cleaning_schedule
      const { error: schedError } = await supabase
        .from('street_cleaning_schedule')
        .update({ geom: geometry, geom_simplified: geometry })
        .eq('ward_section', wardSection);

      if (schedError) {
        console.warn(`Schedule update for ${wardSection}:`, schedError.message);
      }
    }

    // Store confirmation/edit metadata
    try {
      await supabase
        .from('zone_geometry_edits')
        .upsert({
          ward_section: wardSection,
          ward,
          section,
          geometry: geometry || null,
          confirmed: confirmed || false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'ward_section' });
    } catch {
      // Table might not exist - that's ok
    }

    res.status(200).json({ success: true, zone: wardSection, confirmed: !!confirmed });
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
