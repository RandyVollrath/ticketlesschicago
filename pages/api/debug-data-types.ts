import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const MSC_URL = process.env.MSC_SUPABASE_URL;
    const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

    if (!MSC_URL || !MSC_KEY) {
      return res.status(500).json({ error: 'Database credentials not configured' });
    }

    const mscSupabase = createClient(MSC_URL, MSC_KEY);

    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Test the EXACT same queries as the main API
    const { data: allZones, error: allZonesError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, geom_simplified')
      .not('geom_simplified', 'is', null)
      .not('ward', 'is', null)
      .not('section', 'is', null);

    const { data: scheduleData, error: scheduleError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date')
      .not('ward', 'is', null)
      .not('section', 'is', null)
      .gte('cleaning_date', todayStr)
      .order('cleaning_date', { ascending: true });

    // Find Ward 43, Section 1 in both queries
    const ward43Zones = allZones?.filter(z => z.ward === '43' && z.section === '1') || [];
    const ward43ZonesNumber = allZones?.filter(z => z.ward === 43 && z.section === 1) || [];
    const ward43Schedule = scheduleData?.filter(s => s.ward === '43' && s.section === '1') || [];
    const ward43ScheduleNumber = scheduleData?.filter(s => s.ward === 43 && s.section === 1) || [];

    // Test the mapping logic
    const scheduleMap = new Map();
    scheduleData?.forEach(item => {
      const zoneKey = `${item.ward}-${item.section}`;
      if (!scheduleMap.has(zoneKey)) {
        scheduleMap.set(zoneKey, item.cleaning_date);
      }
    });

    const zoneMap = new Map();
    allZones?.forEach(zone => {
      const zoneKey = `${zone.ward}-${zone.section}`;
      if (!zoneMap.has(zoneKey)) {
        let cleaningStatus = 'none';
        let nextCleaningDateISO = null;
        
        if (scheduleMap.has(zoneKey)) {
          const cleaningDate = new Date(scheduleMap.get(zoneKey));
          const diffTime = cleaningDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays === 0) cleaningStatus = 'today';
          else if (diffDays >= 1 && diffDays <= 3) cleaningStatus = 'soon';
          else cleaningStatus = 'later';
          
          nextCleaningDateISO = scheduleMap.get(zoneKey);
        }
        
        zoneMap.set(zoneKey, {
          ward: zone.ward,
          section: zone.section,
          geom_simplified: zone.geom_simplified,
          cleaningStatus,
          nextCleaningDateISO
        });
      }
    });

    const finalWard43 = zoneMap.get('43-1');

    return res.status(200).json({
      success: true,
      queries: {
        allZonesCount: allZones?.length || 0,
        scheduleDataCount: scheduleData?.length || 0
      },
      ward43Section1: {
        inAllZones_string: ward43Zones.length,
        inAllZones_number: ward43ZonesNumber.length,
        inSchedule_string: ward43Schedule.length,
        inSchedule_number: ward43ScheduleNumber.length,
        sampleZone: ward43Zones[0] || null,
        sampleSchedule: ward43Schedule[0] || null
      },
      mapping: {
        scheduleMapHas43_1: scheduleMap.has('43-1'),
        scheduleMapValue: scheduleMap.get('43-1'),
        finalMapHas43_1: zoneMap.has('43-1'),
        finalResult: finalWard43
      },
      errors: {
        allZonesError: allZonesError ? sanitizeErrorMessage(allZonesError) : null,
        scheduleError: scheduleError ? sanitizeErrorMessage(scheduleError) : null
      }
    });

  } catch (error: any) {
    console.error('Debug data types API error:', error);
    return res.status(500).json({
      error: 'Debug API failed'
    });
  }
}