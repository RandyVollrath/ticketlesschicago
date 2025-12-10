import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Main Autopilot America database (snow routes are stored here)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if environment variables are set
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing Supabase credentials - URL:', !!SUPABASE_URL, 'KEY:', !!SUPABASE_ANON_KEY);
    return res.status(500).json({
      error: 'Supabase credentials not configured',
      details: {
        hasUrl: !!SUPABASE_URL,
        hasKey: !!SUPABASE_ANON_KEY
      }
    });
  }

  console.log('✅ Supabase credentials found, creating client...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    console.log('📡 Fetching snow routes from database...');
    // Fetch all snow routes with geometries
    const { data: routes, error } = await supabase
      .from('snow_routes')
      .select('on_street, from_street, to_street, geom')
      .not('geom', 'is', null);

    if (error) {
      console.error('❌ Error fetching snow routes:', error);
      return res.status(500).json({
        error: sanitizeErrorMessage(error)
      });
    }

    console.log(`✅ Successfully fetched ${routes?.length || 0} snow routes`);

    // Transform to GeoJSON format for map
    const geoJsonRoutes = (routes || []).map(route => ({
      type: 'Feature',
      geometry: route.geom,
      properties: {
        on_street: route.on_street,
        from_street: route.from_street,
        to_street: route.to_street
      }
    }));

    return res.status(200).json({
      routes: geoJsonRoutes,
      count: geoJsonRoutes.length
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
