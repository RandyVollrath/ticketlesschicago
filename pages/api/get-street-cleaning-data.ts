import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// TicketlessAmerica database
const TA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const taSupabase = TA_URL && TA_KEY ? createClient(TA_URL, TA_KEY) : null;

// MSC database (fallback)
const MSC_URL = process.env.MSC_SUPABASE_URL;
const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
const mscSupabase = MSC_URL && MSC_KEY ? createClient(MSC_URL, MSC_KEY) : null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const db = taSupabase || mscSupabase;
    if (!db) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    // Lightweight query: just schedule data (no geometry)
    // Geometry is served from static /data/street-cleaning-zones-2026.geojson
    let rawScheduleData: any[] = [];
    const { data: firstBatch, count } = await db
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date', { count: 'exact' })
      .not('ward', 'is', null)
      .not('section', 'is', null)
      .gte('cleaning_date', todayStr)
      .order('cleaning_date', { ascending: true })
      .range(0, 999);

    rawScheduleData = firstBatch || [];
    if (count && count > 1000) {
      for (let i = 1000; i < count; i += 1000) {
        const { data: batch } = await db
          .from('street_cleaning_schedule')
          .select('ward, section, cleaning_date')
          .not('ward', 'is', null)
          .not('section', 'is', null)
          .gte('cleaning_date', todayStr)
          .order('cleaning_date', { ascending: true })
          .range(i, i + 999);
        if (batch) rawScheduleData = rawScheduleData.concat(batch);
      }
    }

    // Filter Sundays
    const scheduleData = rawScheduleData.filter(item => {
      const date = new Date(item.cleaning_date + 'T12:00:00Z');
      return date.getDay() !== 0;
    });

    // Build next-cleaning-date lookup per zone
    const scheduleMap = new Map<string, string>();
    scheduleData.forEach(item => {
      const key = `${item.ward}-${item.section}`;
      if (!scheduleMap.has(key)) scheduleMap.set(key, item.cleaning_date);
    });

    // Build zone status data (no geometry — client merges with static GeoJSON)
    const zones = Array.from(scheduleMap.entries()).map(([key, cleaningDate]) => {
      const [ward, section] = key.split('-');
      let cleaningStatus = 'none';
      if (cleaningDate === todayStr) {
        cleaningStatus = 'today';
      } else {
        const diffDays = Math.round(
          (new Date(cleaningDate + 'T12:00:00Z').getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays >= 1 && diffDays <= 3) cleaningStatus = 'soon';
        else if (diffDays > 3) cleaningStatus = 'later';
      }
      return { ward, section, cleaningStatus, nextCleaningDateISO: cleaningDate };
    });

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      success: true,
      data: zones,
      count: zones.length,
      geometryUrl: '/data/street-cleaning-zones-2026.geojson',
    });

  } catch (error: any) {
    console.error('Street cleaning data API error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
