/**
 * Admin API: Trigger / Monitor Portal Check
 *
 * GET  - Returns status of recent portal check runs
 * POST - Records a manual trigger request (the actual script runs locally/VPS)
 *
 * The portal scraper (scripts/autopilot-check-portal.ts) runs OUTSIDE of Vercel
 * because Playwright requires Chromium (~300MB). This endpoint:
 *   1. Shows recent portal check run history from ticket_audit_log
 *   2. Lets admin trigger a check (sets a flag the local script polls for)
 *   3. Shows cost tracking (captcha spend per run)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getPortalCheckStatus(req, res);
  }
  if (req.method === 'POST') {
    return triggerPortalCheck(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

/**
 * GET - Return recent portal check runs and stats
 */
async function getPortalCheckStatus(_req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get recent portal check completion logs
    const { data: runs, error: runsError } = await supabaseAdmin
      .from('ticket_audit_log')
      .select('*')
      .eq('action', 'portal_check_complete')
      .order('created_at', { ascending: false })
      .limit(20);

    if (runsError) {
      return res.status(500).json({ error: runsError.message });
    }

    // Get pending trigger requests
    const { data: pendingTrigger } = await supabaseAdmin
      .from('autopilot_admin_settings')
      .select('value, updated_at')
      .eq('key', 'portal_check_trigger')
      .single();

    // Get total tickets found by portal scraper
    const { count: totalPortalTickets } = await supabaseAdmin
      .from('detected_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'portal_scrape');

    // Get recent portal-scraped tickets
    const { data: recentTickets } = await supabaseAdmin
      .from('detected_tickets')
      .select(`
        id,
        ticket_number,
        plate,
        state,
        violation_type,
        violation_description,
        amount,
        status,
        created_at,
        user_profiles!detected_tickets_user_id_fkey (
          first_name,
          last_name
        )
      `)
      .eq('source', 'portal_scrape')
      .order('created_at', { ascending: false })
      .limit(20);

    // Compute aggregate stats from runs
    const totalRuns = runs?.length || 0;
    const totalCaptchaCost = runs?.reduce((sum: number, r: any) => sum + (r.details?.captcha_cost || 0), 0) || 0;
    const totalPlatesChecked = runs?.reduce((sum: number, r: any) => sum + (r.details?.plates_checked || 0), 0) || 0;
    const totalTicketsCreated = runs?.reduce((sum: number, r: any) => sum + (r.details?.tickets_created || 0), 0) || 0;
    const lastRun = runs?.[0] || null;

    return res.status(200).json({
      success: true,
      stats: {
        totalRuns,
        totalCaptchaCost: parseFloat(totalCaptchaCost.toFixed(3)),
        totalPlatesChecked,
        totalTicketsCreated,
        totalPortalTickets: totalPortalTickets || 0,
        lastRunAt: lastRun?.created_at || null,
        lastRunDetails: lastRun?.details || null,
      },
      pendingTrigger: pendingTrigger?.value?.status === 'pending'
        ? {
            requestedAt: pendingTrigger.value.requested_at,
            requestedBy: pendingTrigger.value.requested_by,
          }
        : null,
      runs: (runs || []).map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        plates_checked: r.details?.plates_checked || 0,
        tickets_found: r.details?.tickets_found || 0,
        tickets_created: r.details?.tickets_created || 0,
        errors: r.details?.errors || 0,
        captcha_cost: r.details?.captcha_cost || 0,
      })),
      recentTickets: recentTickets || [],
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST - Request a portal check run
 *
 * Sets a flag in autopilot_admin_settings that the local script can poll for.
 * The script checks this flag on startup and clears it after running.
 */
async function triggerPortalCheck(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { requestedBy } = req.body || {};

    // Check if there's already a pending trigger
    const { data: existing } = await supabaseAdmin
      .from('autopilot_admin_settings')
      .select('value')
      .eq('key', 'portal_check_trigger')
      .single();

    if (existing?.value?.status === 'pending') {
      return res.status(409).json({
        error: 'A portal check is already pending',
        requestedAt: existing.value.requested_at,
      });
    }

    // Set the trigger flag
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('autopilot_admin_settings')
      .upsert({
        key: 'portal_check_trigger',
        value: {
          status: 'pending',
          requested_at: now,
          requested_by: requestedBy || 'admin',
        },
        updated_at: now,
      }, { onConflict: 'key' });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Also log the trigger request
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: null,
        user_id: null,
        action: 'portal_check_triggered',
        details: {
          requested_by: requestedBy || 'admin',
          requested_at: now,
          source: 'admin_portal',
        },
        performed_by: requestedBy || 'admin',
      });

    return res.status(200).json({
      success: true,
      message: 'Portal check requested. The script will pick this up on its next run.',
      requestedAt: now,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
