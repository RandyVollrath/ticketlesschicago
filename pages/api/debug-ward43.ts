import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Use the same environment variables as the main API
    const MSC_URL = process.env.MSC_SUPABASE_URL;
    const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

    console.log('Environment check:', {
      MSC_URL: MSC_URL ? MSC_URL.substring(0, 30) + '...' : 'MISSING',
      MSC_KEY: MSC_KEY ? 'SET' : 'MISSING'
    });

    if (!MSC_URL || !MSC_KEY) {
      return res.status(500).json({ 
        error: 'MyStreetCleaning database credentials not configured',
        details: {
          MSC_URL: MSC_URL ? 'SET' : 'MISSING',
          MSC_KEY: MSC_KEY ? 'SET' : 'MISSING'
        }
      });
    }

    const mscSupabase = createClient(MSC_URL, MSC_KEY);

    // Test Ward 43, Section 1 specifically
    const { data: ward43Data, error: ward43Error } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date, geom_simplified')
      .eq('ward', '43')
      .eq('section', '1')
      .limit(10);

    if (ward43Error) {
      console.error('Ward 43 Section 1 query error:', ward43Error);
      return res.status(500).json({ 
        error: 'Database query failed',
        details: ward43Error.message
      });
    }

    // Get geometry data specifically
    const { data: geomData, error: geomError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, geom_simplified')
      .eq('ward', '43')
      .eq('section', '1')
      .not('geom_simplified', 'is', null)
      .limit(1);

    // Get future cleanings
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const { data: futureData, error: futureError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date')
      .eq('ward', '43')
      .eq('section', '1')
      .gte('cleaning_date', todayStr)
      .order('cleaning_date', { ascending: true })
      .limit(5);

    return res.status(200).json({
      success: true,
      environment: {
        MSC_URL: MSC_URL ? MSC_URL.substring(0, 30) + '...' : 'MISSING',
        MSC_KEY: MSC_KEY ? 'SET' : 'MISSING',
        todayDate: todayStr
      },
      ward43Section1: {
        allRecords: ward43Data?.length || 0,
        hasGeometry: geomData?.length || 0,
        futureCleanings: futureData?.length || 0,
        nextCleaning: futureData?.[0]?.cleaning_date || null,
        sampleRecord: ward43Data?.[0] || null,
        geometryRecord: geomData?.[0] || null
      },
      errors: {
        ward43Error: ward43Error?.message || null,
        geomError: geomError?.message || null,
        futureError: futureError?.message || null
      }
    });

  } catch (error: any) {
    console.error('Debug API error:', error);
    return res.status(500).json({ 
      error: 'Debug API failed',
      details: error.message
    });
  }
}