import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// Use MyStreetCleaning database for street cleaning data
const MSC_URL = process.env.MSC_SUPABASE_URL;
const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

if (!MSC_URL || !MSC_KEY) {
  throw new Error('MyStreetCleaning database credentials not configured');
}

const mscSupabase = createClient(MSC_URL, MSC_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🗺️ Loading street cleaning data for map...');
    
    // Get street cleaning schedule data with geometry
    const { data: scheduleData, error } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date, geom_simplified')
      .not('geom_simplified', 'is', null)
      .not('ward', 'is', null)
      .not('section', 'is', null);

    if (error) {
      console.error('❌ Error loading schedule data:', error);
      return res.status(500).json({ error: 'Failed to load street cleaning data' });
    }

    console.log(`✅ Loaded ${scheduleData?.length || 0} street cleaning zones`);

    return res.status(200).json({
      success: true,
      data: scheduleData || [],
      count: scheduleData?.length || 0
    });

  } catch (error: any) {
    console.error('❌ Street cleaning data API error:', error);
    
    return res.status(500).json({ 
      error: 'Failed to load street cleaning data',
      details: error.message
    });
  }
}