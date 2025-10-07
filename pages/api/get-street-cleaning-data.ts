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
    // Get today's date for status calculation
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    // Get ALL street cleaning zones with geometry - using same logic as MSC notification system
    // Note: Supabase has a hard 1000 row limit, so we need to paginate
    // Get first batch to check total count
    const { data: firstBatch, error: allZonesError, count } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, geom_simplified', { count: 'exact' })
      .not('geom_simplified', 'is', null)
      .not('ward', 'is', null)
      .not('section', 'is', null)
      .range(0, 999);

    if (allZonesError) {
      return res.status(500).json({ error: 'Failed to load street cleaning zones' });
    }

    // Fetch remaining batches if needed
    let allZones = firstBatch || [];
    if (count && count > 1000) {
      const numBatches = Math.ceil((count - 1000) / 1000);
      for (let i = 0; i < numBatches; i++) {
        const start = 1000 + (i * 1000);
        const end = start + 999;
        const { data: batch } = await mscSupabase
          .from('street_cleaning_schedule')
          .select('ward, section, geom_simplified')
          .not('geom_simplified', 'is', null)
          .not('ward', 'is', null)
          .not('section', 'is', null)
          .range(start, end);
        if (batch) {
          allZones = allZones.concat(batch);
        }
      }
    }

    // Get future cleaning schedules for status calculation
    // Also needs pagination since there could be >1000 future cleaning dates
    const { data: firstScheduleBatch, error: scheduleError, count: scheduleCount } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date', { count: 'exact' })
      .not('ward', 'is', null)
      .not('section', 'is', null)
      .gte('cleaning_date', todayStr)
      .order('cleaning_date', { ascending: true })
      .range(0, 999);

    if (scheduleError) {
      return res.status(500).json({ error: 'Failed to load street cleaning schedules' });
    }

    // Fetch remaining schedule batches if needed
    let rawScheduleData = firstScheduleBatch || [];
    if (scheduleCount && scheduleCount > 1000) {
      const numBatches = Math.ceil((scheduleCount - 1000) / 1000);
      for (let i = 0; i < numBatches; i++) {
        const start = 1000 + (i * 1000);
        const end = start + 999;
        const { data: batch } = await mscSupabase
          .from('street_cleaning_schedule')
          .select('ward, section, cleaning_date')
          .not('ward', 'is', null)
          .not('section', 'is', null)
          .gte('cleaning_date', todayStr)
          .order('cleaning_date', { ascending: true })
          .range(start, end);
        if (batch) {
          rawScheduleData = rawScheduleData.concat(batch);
        }
      }
    }

    // Filter out invalid Sunday dates (street cleaning never happens on Sunday)
    const scheduleData = rawScheduleData?.filter(item => {
      // Parse date in UTC to avoid timezone conversion issues
      const date = new Date(item.cleaning_date + 'T12:00:00Z');
      const dayOfWeek = date.getDay(); // 0 = Sunday
      if (dayOfWeek === 0) {
        console.warn(`Filtering out invalid Sunday cleaning date: ${item.cleaning_date} for Ward ${item.ward}, Section ${item.section}`);
        return false;
      }
      return true;
    }) || [];

    // Create schedule lookup map for efficient zone-to-date mapping
    const scheduleMap = new Map();
    scheduleData.forEach(item => {
      const zoneKey = `${item.ward}-${item.section}`;
      if (!scheduleMap.has(zoneKey)) {
        scheduleMap.set(zoneKey, item.cleaning_date);
      }
    });

    // Process all zones and assign cleaning status
    const zoneMap = new Map();
    allZones?.forEach(zone => {
      const zoneKey = `${zone.ward}-${zone.section}`;
      if (!zoneMap.has(zoneKey)) {
        let cleaningStatus = 'none';
        let nextCleaningDateISO = null;
        
        // Check if this zone has upcoming cleaning
        if (scheduleMap.has(zoneKey)) {
          const cleaningDateStr = scheduleMap.get(zoneKey);
          nextCleaningDateISO = cleaningDateStr;

          // Compare dates as strings to avoid timezone issues
          if (cleaningDateStr === todayStr) {
            cleaningStatus = 'today';
          } else {
            // Calculate days difference for future dates
            const cleaningDate = new Date(cleaningDateStr + 'T12:00:00Z');
            const diffTime = cleaningDate.getTime() - today.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays >= 1 && diffDays <= 3) {
              cleaningStatus = 'soon';
            } else if (diffDays > 3) {
              cleaningStatus = 'later';
            }
          }
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

    const processedData = Array.from(zoneMap.values());

    return res.status(200).json({
      success: true,
      data: processedData,
      count: processedData.length
    });

  } catch (error: any) {
    console.error('Street cleaning data API error:', error);
    
    return res.status(500).json({ 
      error: 'Failed to load street cleaning data',
      details: error.message
    });
  }
}