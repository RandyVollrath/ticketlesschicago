/**
 * GET /api/block-stats?address=1710+S+Clinton+St
 *
 * Returns block-level ticket stats from 26.8M FOIA tickets (2019-2024).
 * Parses the address into block_id components and calls the
 * get_block_ticket_summary RPC function.
 *
 * Also returns ZIP stats if a zip parameter is provided.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { parseChicagoAddress } from '../../lib/address-parser';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Friendly category names for display
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
  speed_camera_warning: 'Speed Camera Warning',
  red_light_camera: 'Red Light Camera',
  plate_violation: 'Plate Violation',
  traffic_signal: 'Stop Sign/Signal',
  disabled_parking: 'Disabled Parking',
  truck_violation: 'Truck/RV/Bus',
  snow_removal: 'Snow Removal',
  bus_zone: 'Bus/Taxi Zone',
  loading_zone: 'Loading Zone',
  obstruct_roadway: 'Obstruct Roadway',
  wrong_direction: 'Wrong Direction',
  expired_plate: 'Expired Plate',
  other: 'Other',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const address = (req.query.address as string || '').trim();
  const zip = (req.query.zip as string || '').trim();

  if (!address && !zip) {
    return res.status(400).json({ error: 'address or zip parameter required' });
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
    let blockData: any = null;
    let zipData: any = null;

    // Parse address and get block stats
    if (address) {
      const parsed = parseChicagoAddress(address);
      if (!parsed) {
        return res.status(400).json({ error: 'Could not parse address. Use format: 1710 S Clinton St' });
      }

      // The FOIA data block IDs use street name WITHOUT type (no "ST", "AVE", etc.)
      // parseChicagoAddress extracts: number, direction, name (without type), type
      const { data, error } = await supabaseAdmin.rpc('get_block_ticket_summary', {
        p_street_number: String(parsed.number),
        p_street_direction: parsed.direction || '',
        p_street_name: parsed.name,
      });

      if (error) {
        console.error('[block-stats] RPC error:', error.message);
        return res.status(500).json({ error: 'Failed to query block stats' });
      }

      blockData = data;

      // Enrich with friendly labels
      if (blockData && blockData.by_category) {
        blockData.by_category = blockData.by_category.map((cat: any) => ({
          ...cat,
          label: CATEGORY_LABELS[cat.category] || cat.category,
        }));
      }

      // Add per-year average
      if (blockData && blockData.total_tickets > 0 && blockData.by_year?.length > 0) {
        blockData.avg_tickets_per_year = Math.round(blockData.total_tickets / blockData.by_year.length);
        blockData.avg_fines_per_year = Math.round(blockData.total_fines / blockData.by_year.length);
      }

      // Categories that free alerts actually help prevent
      const ALERTABLE_CATEGORIES = new Set([
        'street_cleaning', 'snow_removal',
      ]);

      // Compute alertable ticket stats
      if (blockData && blockData.by_category) {
        const alertableCats = blockData.by_category
          .filter((cat: any) => ALERTABLE_CATEGORIES.has(cat.category));
        const alertableTickets = alertableCats
          .reduce((sum: number, cat: any) => sum + cat.tickets, 0);
        const alertableFines = alertableCats
          .reduce((sum: number, cat: any) => sum + cat.fines, 0);
        blockData.alertable_tickets = alertableTickets;
        blockData.alertable_fines = Math.round(alertableFines);
        blockData.alertable_pct = blockData.total_tickets > 0
          ? Math.round((alertableTickets / blockData.total_tickets) * 100)
          : 0;
      }

      // Compute risk insight text
      if (blockData && blockData.total_tickets > 0) {
        const topCat = blockData.by_category?.[0];
        const avgPerYear = blockData.avg_tickets_per_year || 0;

        let insight = '';
        if (avgPerYear > 500) {
          insight = `This is a very high-ticket block with ~${avgPerYear.toLocaleString()} tickets/year.`;
        } else if (avgPerYear > 200) {
          insight = `This block sees significant enforcement with ~${avgPerYear.toLocaleString()} tickets/year.`;
        } else if (avgPerYear > 50) {
          insight = `This block has moderate enforcement activity (~${avgPerYear.toLocaleString()} tickets/year).`;
        } else if (avgPerYear > 10) {
          insight = `This block has light enforcement (~${avgPerYear.toLocaleString()} tickets/year).`;
        } else {
          insight = `This block has minimal enforcement activity.`;
        }

        if (topCat) {
          const label = CATEGORY_LABELS[topCat.category] || topCat.category;
          const pct = Math.round((topCat.tickets / blockData.total_tickets) * 100);
          insight += ` ${label} is the #1 violation (${pct}% of tickets).`;
        }

        blockData.insight = insight;
      }
    }

    // Get ZIP stats
    if (zip && zip.length === 5) {
      const { data, error } = await supabaseAdmin.rpc('get_zip_ticket_summary', {
        p_zip_code: zip,
      });

      if (error) {
        console.error('[block-stats] ZIP RPC error:', error.message);
      } else {
        zipData = data;
        if (zipData && zipData.by_category) {
          zipData.by_category = zipData.by_category.map((cat: any) => ({
            ...cat,
            label: CATEGORY_LABELS[cat.category] || cat.category,
          }));
        }
      }
    }

    // Cache for 1 hour (static data)
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      block: blockData,
      zip: zipData,
    });
  } catch (err: any) {
    console.error('[block-stats] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
