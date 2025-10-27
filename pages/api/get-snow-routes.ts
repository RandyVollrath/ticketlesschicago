import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// MyStreetCleaning database for snow routes
const MSC_SUPABASE_URL = process.env.MSC_SUPABASE_URL;
const MSC_SUPABASE_ANON_KEY = process.env.MSC_SUPABASE_ANON_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if environment variables are set
  if (!MSC_SUPABASE_URL || !MSC_SUPABASE_ANON_KEY) {
    console.error('❌ Missing MSC Supabase credentials - URL:', !!MSC_SUPABASE_URL, 'KEY:', !!MSC_SUPABASE_ANON_KEY);
    return res.status(500).json({
      error: 'MSC Supabase credentials not configured',
      details: {
        hasUrl: !!MSC_SUPABASE_URL,
        hasKey: !!MSC_SUPABASE_ANON_KEY
      }
    });
  }

  console.log('✅ MSC Supabase credentials found, creating client...');
  const mscSupabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_ANON_KEY);

  try {
    console.log('📡 Fetching snow routes from MSC database...');
    // Fetch all snow routes with geometries
    const { data: routes, error } = await mscSupabase
      .from('snow_routes')
      .select('on_street, from_street, to_street, geom')
      .not('geom', 'is', null);

    if (error) {
      console.error('❌ Error fetching snow routes:', error);
      return res.status(500).json({
        error: 'Failed to fetch snow routes',
        details: error.message,
        code: error.code
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
