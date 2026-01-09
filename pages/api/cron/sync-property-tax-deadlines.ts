/**
 * Sync Property Tax Deadlines
 *
 * This cron job initializes the property_tax_deadlines table with
 * UNKNOWN status for all townships. Actual deadline data must be
 * populated manually or via admin upload once official dates are published.
 *
 * Deadlines are NOT hardcoded to avoid incorrect filing guidance.
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

// Deadline status constants
export const DEADLINE_STATUS = {
  UNKNOWN: 'unknown',      // Deadlines not yet available
  CONFIRMED: 'confirmed',  // Deadlines verified from official source
  EXPIRED: 'expired',      // Filing period has passed
} as const;

export type DeadlineStatus = typeof DEADLINE_STATUS[keyof typeof DEADLINE_STATUS];

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

    const stats = {
      created: 0,
      skipped: 0,
      errors: 0
    };

    // Ensure each township has a deadline record for the current year
    // Status will be UNKNOWN until manually populated
    for (const township of TOWNSHIPS) {
      try {
        const { data: existing } = await supabase
          .from('property_tax_deadlines')
          .select('id, status')
          .eq('township', township)
          .eq('year', year)
          .single();

        if (existing) {
          // Record exists, don't overwrite
          stats.skipped++;
          continue;
        }

        // Create placeholder record with UNKNOWN status
        const { error: insertError } = await supabase
          .from('property_tax_deadlines')
          .insert({
            year,
            township,
            status: DEADLINE_STATUS.UNKNOWN,
            source_url: null,
            bor_open_date: null,
            bor_close_date: null,
            ccao_open_date: null,
            ccao_close_date: null,
            last_verified_at: null,
            updated_at: new Date().toISOString()
          });

        if (insertError) {
          console.error(`Error creating ${township}:`, insertError);
          stats.errors++;
        } else {
          stats.created++;
        }
      } catch (error) {
        // Single query error (no row found) is expected
        if ((error as any)?.code !== 'PGRST116') {
          console.error(`Error processing ${township}:`, error);
          stats.errors++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      year,
      message: 'Township deadline placeholders initialized. Populate actual dates via admin.',
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
