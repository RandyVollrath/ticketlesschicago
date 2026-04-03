/**
 * GET /api/zip-marketing-stats
 *
 * Returns ZIP code-level ticket statistics for marketing/ad targeting.
 * Ranks Chicago ZIP codes by ticket volume, total fines, and most common
 * violation types — useful for targeting digital ads to highest-ticket areas.
 *
 * Query params:
 *   limit (optional) - Number of ZIPs to return (default: 50, max: 100)
 *   sort (optional) - Sort by 'tickets' | 'fines' | 'avg_fine' (default: tickets)
 *   category (optional) - Filter to specific violation category
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY (admin-only endpoint)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CATEGORY_LABELS: Record<string, string> = {
  street_cleaning: 'Street Cleaning',
  expired_meter: 'Expired Meter',
  city_sticker: 'City Sticker',
  permit_parking: 'Permit Parking',
  no_parking: 'No Parking/Standing',
  fire_hydrant: 'Fire Hydrant',
  rush_hour: 'Rush Hour',
  double_parking: 'Double Parking',
  speed_camera: 'Speed Camera',
  red_light_camera: 'Red Light Camera',
  plate_violation: 'Plate Violation',
  traffic_signal: 'Stop Sign/Signal',
  disabled_parking: 'Disabled Parking',
  truck_violation: 'Truck/RV/Bus',
  snow_removal: 'Snow Removal',
  bus_zone: 'Bus/Taxi Zone',
  loading_zone: 'Loading Zone',
  other: 'Other',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const sort = (req.query.sort as string) || 'tickets';
  const category = (req.query.category as string) || '';

  try {
    // Build query to aggregate ZIP stats
    let query = supabaseAdmin
      .from('foia_zip_stats')
      .select('zip_code, violation_category, year, ticket_count, fines_base, paid_count, dismissed_count');

    if (category) {
      query = query.eq('violation_category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[zip-marketing] Query error:', error.message);
      return res.status(500).json({ error: 'Failed to query ZIP stats' });
    }

    if (!data || data.length === 0) {
      return res.status(200).json({ zips: [], total_zips: 0 });
    }

    // Aggregate by ZIP code
    const zipMap: Record<string, {
      zip_code: string;
      total_tickets: number;
      total_fines: number;
      paid_count: number;
      dismissed_count: number;
      years: Set<number>;
      categories: Record<string, number>;
    }> = {};

    for (const row of data) {
      if (!zipMap[row.zip_code]) {
        zipMap[row.zip_code] = {
          zip_code: row.zip_code,
          total_tickets: 0,
          total_fines: 0,
          paid_count: 0,
          dismissed_count: 0,
          years: new Set(),
          categories: {},
        };
      }
      const z = zipMap[row.zip_code];
      z.total_tickets += row.ticket_count;
      z.total_fines += row.fines_base;
      z.paid_count += row.paid_count;
      z.dismissed_count += row.dismissed_count;
      z.years.add(row.year);
      z.categories[row.violation_category] = (z.categories[row.violation_category] || 0) + row.ticket_count;
    }

    // Convert to array and compute derived metrics
    const zips = Object.values(zipMap).map(z => {
      const yearCount = z.years.size || 1;
      const topCategories = Object.entries(z.categories)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([cat, tickets]) => ({
          category: cat,
          label: CATEGORY_LABELS[cat] || cat,
          tickets,
          pct: Math.round((tickets / z.total_tickets) * 100),
        }));

      return {
        zip_code: z.zip_code,
        total_tickets: z.total_tickets,
        total_fines: Math.round(z.total_fines),
        avg_tickets_per_year: Math.round(z.total_tickets / yearCount),
        avg_fine_per_ticket: z.total_tickets > 0 ? Math.round(z.total_fines / z.total_tickets) : 0,
        paid_rate: z.total_tickets > 0 ? Math.round((z.paid_count / z.total_tickets) * 100) : 0,
        dismissed_rate: z.total_tickets > 0 ? Math.round((z.dismissed_count / z.total_tickets) * 100) : 0,
        top_categories: topCategories,
        year_count: yearCount,
      };
    });

    // Sort
    if (sort === 'fines') {
      zips.sort((a, b) => b.total_fines - a.total_fines);
    } else if (sort === 'avg_fine') {
      zips.sort((a, b) => b.avg_fine_per_ticket - a.avg_fine_per_ticket);
    } else {
      zips.sort((a, b) => b.total_tickets - a.total_tickets);
    }

    const result = zips.slice(0, limit);

    // Summary stats
    const totalTickets = zips.reduce((s, z) => s + z.total_tickets, 0);
    const totalFines = zips.reduce((s, z) => s + z.total_fines, 0);

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

    return res.status(200).json({
      zips: result,
      total_zips: zips.length,
      total_tickets: totalTickets,
      total_fines: totalFines,
      data_period: '2019-2024',
      source: 'City of Chicago FOIA (35.7M tickets)',
    });
  } catch (err: any) {
    console.error('[zip-marketing] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
