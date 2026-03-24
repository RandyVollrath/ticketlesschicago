/**
 * GET /api/zip-ticket-stats?zip=60614
 *
 * Public endpoint: returns ticket statistics for a single Chicago ZIP code.
 * Used by the /ticket-cost estimator page.
 *
 * Query params:
 *   zip (required) - Chicago ZIP code (5 digits)
 *
 * Returns: ticket counts, fines, top violation categories, yearly breakdown
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';

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

  const zip = (req.query.zip as string || '').trim();
  if (!zip || !/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'Valid 5-digit ZIP code required' });
  }

  // Rate limiting — 100 requests per minute per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  try {
    const { data, error } = await supabaseAdmin
      .from('foia_zip_stats')
      .select('zip_code, violation_category, year, ticket_count, fines_base, paid_count, dismissed_count')
      .eq('zip_code', zip)
      .limit(1000);

    if (error) {
      console.error('[zip-ticket-stats] Query error:', error.message);
      return res.status(500).json({ error: 'Failed to query ZIP stats' });
    }

    if (!data || data.length === 0) {
      return res.status(200).json({
        found: false,
        zip_code: zip,
        message: 'No ticket data found for this ZIP code. This may not be a Chicago ZIP code.',
      });
    }

    // Aggregate across years and categories
    let totalTickets = 0;
    let totalFines = 0;
    let totalPaid = 0;
    let totalDismissed = 0;
    const years = new Set<number>();
    const categories: Record<string, { tickets: number; fines: number }> = {};
    const yearlyBreakdown: Record<number, { tickets: number; fines: number }> = {};

    for (const row of data) {
      totalTickets += row.ticket_count;
      totalFines += row.fines_base;
      totalPaid += row.paid_count;
      totalDismissed += row.dismissed_count;
      years.add(row.year);

      if (!categories[row.violation_category]) {
        categories[row.violation_category] = { tickets: 0, fines: 0 };
      }
      categories[row.violation_category].tickets += row.ticket_count;
      categories[row.violation_category].fines += row.fines_base;

      if (!yearlyBreakdown[row.year]) {
        yearlyBreakdown[row.year] = { tickets: 0, fines: 0 };
      }
      yearlyBreakdown[row.year].tickets += row.ticket_count;
      yearlyBreakdown[row.year].fines += row.fines_base;
    }

    const yearCount = years.size || 1;

    // Top categories sorted by ticket count
    const topCategories = Object.entries(categories)
      .sort(([, a], [, b]) => b.tickets - a.tickets)
      .slice(0, 6)
      .map(([cat, stats]) => ({
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        tickets: stats.tickets,
        fines: Math.round(stats.fines),
        pct: Math.round((stats.tickets / totalTickets) * 100),
        avg_fine: stats.tickets > 0 ? Math.round(stats.fines / stats.tickets) : 0,
      }));

    // Yearly breakdown sorted by year
    const yearly = Object.entries(yearlyBreakdown)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([year, stats]) => ({
        year: parseInt(year),
        tickets: stats.tickets,
        fines: Math.round(stats.fines),
      }));

    const avgTicketsPerYear = Math.round(totalTickets / yearCount);
    const avgFinesPerYear = Math.round(totalFines / yearCount);

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

    return res.status(200).json({
      found: true,
      zip_code: zip,
      total_tickets: totalTickets,
      total_fines: Math.round(totalFines),
      avg_tickets_per_year: avgTicketsPerYear,
      avg_fines_per_year: avgFinesPerYear,
      avg_fine_per_ticket: totalTickets > 0 ? Math.round(totalFines / totalTickets) : 0,
      paid_rate: totalTickets > 0 ? Math.round((totalPaid / totalTickets) * 100) : 0,
      dismissed_rate: totalTickets > 0 ? Math.round((totalDismissed / totalTickets) * 100) : 0,
      top_categories: topCategories,
      yearly_breakdown: yearly,
      year_count: yearCount,
      data_period: `${Math.min(...years)}-${Math.max(...years)}`,
    });
  } catch (err: any) {
    console.error('[zip-ticket-stats] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
