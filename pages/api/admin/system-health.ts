import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * System Health API — Admin overview of system status
 *
 * Returns: Lob mode, kill switches, blocking issues, letter stats, env vars.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch all data in parallel
    const [
      killSwitchResult,
      pendingReviewResult,
      stuckLettersResult,
      returnedMailResult,
      urgentDeadlinesResult,
      webhookHealthResult,
      userStatsResult,
    ] = await Promise.all([
      // Kill switches
      supabase
        .from('autopilot_admin_settings')
        .select('key, value, setting_key, setting_value')
        .or('key.in.(pause_all_mail,pause_ticket_processing,require_approval_all),setting_key.in.(kill_all_mailing,maintenance_mode)'),

      // Letters needing admin review
      supabase
        .from('contest_letters')
        .select('id, status, created_at')
        .in('status', ['needs_admin_review', 'draft', 'pending_approval'])
        .order('created_at', { ascending: true }),

      // Stuck letters (approved but not mailed for > 2 days)
      supabase
        .from('contest_letters')
        .select('id, status, updated_at')
        .in('status', ['admin_approved', 'ready_to_mail', 'approved'])
        .lt('updated_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()),

      // Returned mail
      supabase
        .from('contest_letters')
        .select('id, lob_status')
        .eq('lob_status', 'returned'),

      // Tickets with deadlines in next 5 days that aren't mailed yet
      supabase
        .from('detected_tickets')
        .select('id, ticket_number, violation_date, plate')
        .not('status', 'in', '(dismissed,paid,cancelled)')
        .gte('violation_date', new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('violation_date', { ascending: true }),

      // Latest webhook health check
      supabase
        .from('webhook_health_checks')
        .select('webhook_name, status, created_at, checks')
        .order('created_at', { ascending: false })
        .limit(5),

      // Active user count
      supabase
        .from('autopilot_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
    ]);

    // Parse kill switches (handle both column name patterns)
    const killSwitches: Record<string, boolean> = {
      pause_all_mail: false,
      pause_ticket_processing: false,
      require_approval_all: false,
      kill_all_mailing: false,
      maintenance_mode: false,
    };

    for (const setting of killSwitchResult.data || []) {
      const key = setting.key || setting.setting_key;
      const value = setting.value || setting.setting_value;
      if (key && key in killSwitches) {
        killSwitches[key] = !!value?.enabled;
      }
    }

    // Compute urgent deadlines (tickets where mail_by_deadline is within 5 days)
    const now = new Date();
    const urgentTickets = (urgentDeadlinesResult.data || [])
      .map(ticket => {
        if (!ticket.violation_date) return null;
        const violationDate = new Date(ticket.violation_date + 'T12:00:00-05:00');
        const mailByDeadline = new Date(violationDate);
        mailByDeadline.setDate(mailByDeadline.getDate() + 21);
        const daysUntil = Math.ceil((mailByDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 5 && daysUntil >= 0) {
          return { ...ticket, days_until_deadline: daysUntil, mail_by_deadline: mailByDeadline.toISOString() };
        }
        return null;
      })
      .filter(Boolean);

    // Build blocking issues list
    const blockingIssues: Array<{ severity: 'critical' | 'warning' | 'info'; message: string; count?: number }> = [];

    // Lob test mode
    const lobTestMode = process.env.LOB_TEST_MODE === 'true';
    if (lobTestMode) {
      blockingIssues.push({ severity: 'warning', message: 'Lob is in TEST MODE — letters are sent to user address, not city hall' });
    }

    // Kill switches
    if (killSwitches.pause_all_mail || killSwitches.kill_all_mailing) {
      blockingIssues.push({ severity: 'critical', message: 'MAIL PAUSED — no letters will be sent via Lob' });
    }
    if (killSwitches.pause_ticket_processing) {
      blockingIssues.push({ severity: 'critical', message: 'TICKET PROCESSING PAUSED — no new letters will be generated' });
    }
    if (killSwitches.maintenance_mode) {
      blockingIssues.push({ severity: 'critical', message: 'MAINTENANCE MODE — all autopilot operations paused' });
    }
    if (killSwitches.require_approval_all) {
      blockingIssues.push({ severity: 'info', message: 'Admin approval required for ALL letters before mailing' });
    }

    // Pending reviews
    const pendingReviewCount = pendingReviewResult.data?.length || 0;
    if (pendingReviewCount > 0) {
      blockingIssues.push({ severity: 'warning', message: `${pendingReviewCount} letter(s) awaiting admin review`, count: pendingReviewCount });
    }

    // Stuck letters
    const stuckCount = stuckLettersResult.data?.length || 0;
    if (stuckCount > 0) {
      blockingIssues.push({ severity: 'warning', message: `${stuckCount} approved letter(s) stuck — not mailed for 48+ hours`, count: stuckCount });
    }

    // Returned mail
    const returnedCount = returnedMailResult.data?.length || 0;
    if (returnedCount > 0) {
      blockingIssues.push({ severity: 'critical', message: `${returnedCount} letter(s) returned by mail`, count: returnedCount });
    }

    // Urgent deadlines
    if (urgentTickets.length > 0) {
      blockingIssues.push({ severity: 'critical', message: `${urgentTickets.length} ticket(s) have contest deadlines in ≤5 days`, count: urgentTickets.length });
    }

    // Webhook health
    const unhealthyWebhooks = (webhookHealthResult.data || []).filter(w => w.status === 'unhealthy');
    if (unhealthyWebhooks.length > 0) {
      blockingIssues.push({ severity: 'warning', message: `${unhealthyWebhooks.length} webhook(s) reporting unhealthy` });
    }

    // Missing critical env vars
    const envChecks: Array<{ name: string; present: boolean }> = [
      { name: 'LOB_API_KEY', present: !!process.env.LOB_API_KEY },
      { name: 'RESEND_API_KEY', present: !!process.env.RESEND_API_KEY },
      { name: 'OPENAI_API_KEY', present: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) },
      { name: 'GOOGLE_MAPS_API_KEY', present: !!process.env.GOOGLE_MAPS_API_KEY },
    ];
    const missingEnv = envChecks.filter(e => !e.present);
    if (missingEnv.length > 0) {
      blockingIssues.push({
        severity: 'critical',
        message: `Missing env vars: ${missingEnv.map(e => e.name).join(', ')}`,
      });
    }

    return res.status(200).json({
      success: true,
      lob: {
        mode: lobTestMode ? 'test' : 'live',
        api_key_present: !!process.env.LOB_API_KEY,
      },
      kill_switches: killSwitches,
      blocking_issues: blockingIssues,
      counts: {
        pending_review: pendingReviewCount,
        stuck_letters: stuckCount,
        returned_mail: returnedCount,
        urgent_deadlines: urgentTickets.length,
        active_users: userStatsResult.count || 0,
      },
      urgent_tickets: urgentTickets,
      env_checks: envChecks,
      webhook_health: webhookHealthResult.data || [],
    });
  } catch (error: any) {
    console.error('System health error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
