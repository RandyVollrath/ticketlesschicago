/**
 * Cron endpoint: Chicago Open Data Monitor
 *
 * Runs weekly to detect:
 * - Speed/red-light camera additions and removals
 * - Signage work orders (311)
 * - Construction zones affecting parking
 *
 * Schedule: Weekly Sunday 03:00 UTC (Saturday 9pm Chicago)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { runFullMonitoringScan } from '../../../lib/chicago-open-data-monitor';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const cronSecret = req.headers['authorization']?.replace('Bearer ', '');
  if (cronSecret !== process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const result = await runFullMonitoringScan(supabase);

    // If camera changes detected, log them for admin review
    if (result.cameraChanges.length > 0) {
      console.log('CAMERA CHANGES DETECTED:');
      for (const change of result.cameraChanges) {
        console.log(`  [${change.type}] ${change.action}: ${change.address}`);
        console.log(`    ${change.details}`);
      }

      // Store camera changes for admin notification
      try {
        for (const change of result.cameraChanges) {
          await supabase.from('audit_logs').insert({
            action: `camera_${change.action}`,
            details: {
              type: change.type,
              address: change.address,
              details: change.details,
            },
          });
        }
      } catch { /* Audit log write is non-critical */ }
    }

    return res.status(200).json({
      success: true,
      cameraChanges: result.cameraChanges.length,
      signageWorkOrders: result.signageWorkOrders.length,
      timestamp: result.timestamp,
    });
  } catch (error) {
    console.error('Open data monitor failed:', error);
    return res.status(500).json({ error: 'Monitor failed', details: String(error) });
  }
}
