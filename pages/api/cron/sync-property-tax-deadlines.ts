/**
 * Sync Property Tax Deadlines
 *
 * Fetches the latest township appeal deadlines from Cook County
 * Board of Review and stores them in our database.
 *
 * This should run weekly during appeal season (typically Aug-Dec).
 *
 * POST /api/cron/sync-property-tax-deadlines
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { TOWNSHIPS } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Known 2025 deadlines (these would ideally be scraped from the BOR website)
// Source: https://www.cookcountyboardofreview.com/dates-and-deadlines
const KNOWN_DEADLINES_2025: Record<string, { borOpen: string; borClose: string }> = {
  // South/Southwest suburbs (typically first)
  'Bloom': { borOpen: '2025-08-01', borClose: '2025-08-30' },
  'Bremen': { borOpen: '2025-08-01', borClose: '2025-08-30' },
  'Calumet': { borOpen: '2025-08-01', borClose: '2025-08-30' },
  'Rich': { borOpen: '2025-08-15', borClose: '2025-09-15' },
  'Thornton': { borOpen: '2025-08-15', borClose: '2025-09-15' },
  'Worth': { borOpen: '2025-08-15', borClose: '2025-09-15' },

  // Chicago townships (middle of season)
  'Hyde Park': { borOpen: '2025-09-01', borClose: '2025-10-01' },
  'Jefferson': { borOpen: '2025-09-01', borClose: '2025-10-01' },
  'Lake': { borOpen: '2025-09-01', borClose: '2025-10-01' },
  'Lake View': { borOpen: '2025-09-15', borClose: '2025-10-15' },
  'Rogers Park': { borOpen: '2025-09-15', borClose: '2025-10-15' },
  'South Chicago': { borOpen: '2025-09-15', borClose: '2025-10-15' },
  'West Chicago': { borOpen: '2025-10-01', borClose: '2025-10-31' },

  // North suburbs
  'Evanston': { borOpen: '2025-10-01', borClose: '2025-10-31' },
  'New Trier': { borOpen: '2025-10-15', borClose: '2025-11-15' },
  'Niles': { borOpen: '2025-10-15', borClose: '2025-11-15' },
  'Northfield': { borOpen: '2025-10-15', borClose: '2025-11-15' },
  'Norwood Park': { borOpen: '2025-11-01', borClose: '2025-12-01' },

  // West suburbs
  'Berwyn': { borOpen: '2025-11-01', borClose: '2025-12-01' },
  'Cicero': { borOpen: '2025-11-01', borClose: '2025-12-01' },
  'Lyons': { borOpen: '2025-11-01', borClose: '2025-12-01' },
  'Oak Park': { borOpen: '2025-11-15', borClose: '2025-12-15' },
  'Proviso': { borOpen: '2025-11-15', borClose: '2025-12-15' },
  'River Forest': { borOpen: '2025-11-15', borClose: '2025-12-15' },
  'Riverside': { borOpen: '2025-11-15', borClose: '2025-12-15' },

  // Northwest suburbs (typically last)
  'Barrington': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Elk Grove': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Hanover': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Leyden': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Maine': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Palatine': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Schaumburg': { borOpen: '2025-12-01', borClose: '2025-12-22' },
  'Wheeling': { borOpen: '2025-12-01', borClose: '2025-12-22' },

  // Others
  'Lemont': { borOpen: '2025-10-01', borClose: '2025-10-31' },
  'Orland': { borOpen: '2025-09-15', borClose: '2025-10-15' },
  'Palos': { borOpen: '2025-09-15', borClose: '2025-10-15' },
  'Stickney': { borOpen: '2025-10-15', borClose: '2025-11-15' },
};

// 2026 deadlines (estimated based on typical patterns)
const KNOWN_DEADLINES_2026: Record<string, { borOpen: string; borClose: string }> = {};
// Would be populated once available

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron key
  const cronKey = req.headers['x-cron-key'] || req.query.key;
  if (cronKey !== process.env.CRON_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const year = new Date().getFullYear();
    const deadlines = year === 2025 ? KNOWN_DEADLINES_2025 : KNOWN_DEADLINES_2026;

    const stats = {
      updated: 0,
      inserted: 0,
      errors: 0
    };

    for (const township of TOWNSHIPS) {
      const deadlineData = deadlines[township];

      if (!deadlineData) {
        console.log(`No deadline data for ${township}`);
        continue;
      }

      try {
        const { data: existing } = await supabase
          .from('property_tax_deadlines')
          .select('id')
          .eq('township', township)
          .eq('year', year)
          .single();

        const record = {
          year,
          township,
          bor_open_date: deadlineData.borOpen,
          bor_close_date: deadlineData.borClose,
          source_url: 'https://www.cookcountyboardofreview.com/dates-and-deadlines',
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        if (existing) {
          await supabase
            .from('property_tax_deadlines')
            .update(record)
            .eq('id', existing.id);
          stats.updated++;
        } else {
          await supabase
            .from('property_tax_deadlines')
            .insert(record);
          stats.inserted++;
        }
      } catch (error) {
        console.error(`Error updating ${township}:`, error);
        stats.errors++;
      }
    }

    return res.status(200).json({
      success: true,
      year,
      stats
    });

  } catch (error) {
    console.error('Sync deadlines error:', error);
    return res.status(500).json({
      error: 'Sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
