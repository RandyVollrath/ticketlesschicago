import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Use MyStreetCleaning database for geometry data
const MSC_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes';

const mscSupabase = createClient(MSC_URL, MSC_KEY);

interface ZoneRequest {
  ward: string;
  section: string;
  isUser?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { zones }: { zones: ZoneRequest[] } = req.body;

  if (!zones || !Array.isArray(zones)) {
    return res.status(400).json({ 
      error: 'Invalid request: zones array is required',
      example: { zones: [{ ward: "1", section: "1", isUser: true }] }
    });
  }

  try {
    console.log(`🗺️ Fetching geometry data for ${zones.length} zones`);
    
    const features = await Promise.all(
      zones.map(async (zone) => {
        try {
          // Query MyStreetCleaning database for geometry data
          const { data: geometryData, error } = await mscSupabase
            .from('street_cleaning_schedule')
            .select('geom_simplified, ward, section, cleaning_date, north_block, south_block, east_block, west_block')
            .eq('ward', zone.ward)
            .eq('section', zone.section)
            .not('geom_simplified', 'is', null)
            .limit(1);

          if (error) {
            console.error(`❌ Error fetching geometry for Ward ${zone.ward}, Section ${zone.section}:`, error);
            return null;
          }

          if (!geometryData || geometryData.length === 0) {
            console.warn(`⚠️ No geometry found for Ward ${zone.ward}, Section ${zone.section}`);
            return {
              properties: {
                id: `${zone.ward}-${zone.section}`,
                ward: zone.ward,
                section: zone.section,
                cleaningStatus: zone.isUser ? 'today' : 'later',
                north_block: null,
                south_block: null,
                east_block: null,
                west_block: null
              },
              geometry: null
            };
          }

          const geoData = geometryData[0];
          
          // Get next cleaning date for this zone
          const todayStr = new Date().toISOString().split('T')[0];
          const { data: nextCleaning } = await mscSupabase
            .from('street_cleaning_schedule')
            .select('cleaning_date')
            .eq('ward', zone.ward)
            .eq('section', zone.section)
            .gte('cleaning_date', todayStr)
            .order('cleaning_date', { ascending: true })
            .limit(1);

          // Determine cleaning status
          let cleaningStatus: 'today' | 'soon' | 'later' | 'none' = 'none';
          if (zone.isUser) {
            cleaningStatus = 'today'; // User location is always marked as "today"
          } else if (nextCleaning && nextCleaning.length > 0) {
            const nextDate = new Date(nextCleaning[0].cleaning_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const diffTime = nextDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) cleaningStatus = 'today';
            else if (diffDays <= 3) cleaningStatus = 'soon';
            else cleaningStatus = 'later';
          }

          return {
            properties: {
              id: `${zone.ward}-${zone.section}`,
              ward: zone.ward,
              section: zone.section,
              cleaningStatus,
              nextCleaningDateISO: nextCleaning && nextCleaning.length > 0 ? nextCleaning[0].cleaning_date : undefined,
              north_block: geoData.north_block,
              south_block: geoData.south_block,
              east_block: geoData.east_block,
              west_block: geoData.west_block
            },
            geometry: geoData.geom_simplified
          };

        } catch (error) {
          console.error(`❌ Error processing zone ${zone.ward}-${zone.section}:`, error);
          return null;
        }
      })
    );

    // Filter out null results and format response
    const validFeatures = features.filter(f => f !== null);
    
    console.log(`✅ Successfully processed ${validFeatures.length}/${zones.length} zones`);

    const response = {
      type: 'FeatureCollection',
      features: validFeatures,
      metadata: {
        total_requested: zones.length,
        total_found: validFeatures.length,
        zones_with_geometry: validFeatures.filter(f => f.geometry !== null).length,
        zones_without_geometry: validFeatures.filter(f => f.geometry === null).length
      }
    };

    return res.status(200).json(response);

  } catch (error: any) {
    console.error('❌ Zone geometry API error:', error);

    return res.status(500).json({
      error: 'Failed to fetch zone geometry data'
    });
  }
}