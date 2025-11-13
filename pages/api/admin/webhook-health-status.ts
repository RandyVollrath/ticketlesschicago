/**
 * Webhook Health Status Dashboard API
 *
 * Returns recent health check results for monitoring webhooks.
 * Shows last 30 days of health checks.
 *
 * GET /api/admin/webhook-health-status
 * GET /api/admin/webhook-health-status?webhook=utility-bills
 * GET /api/admin/webhook-health-status?days=7
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhook = (req.query.webhook as string) || 'utility-bills';
    const days = parseInt(req.query.days as string) || 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Get health check results
    const { data: checks, error } = await supabase
      .from('webhook_health_checks')
      .select('*')
      .eq('webhook_name', webhook)
      .gte('check_time', cutoffDate.toISOString())
      .order('check_time', { ascending: false });

    if (error) {
      throw error;
    }

    // Calculate stats
    const totalChecks = checks?.length || 0;
    const healthyChecks = checks?.filter(c => c.overall_status === 'healthy').length || 0;
    const unhealthyChecks = totalChecks - healthyChecks;
    const alertsSent = checks?.filter(c => c.alert_sent).length || 0;
    const lastCheck = checks?.[0];
    const uptime = totalChecks > 0 ? ((healthyChecks / totalChecks) * 100).toFixed(2) : '0.00';

    // Get recent failures
    const recentFailures = checks
      ?.filter(c => c.overall_status !== 'healthy')
      .slice(0, 5)
      .map(c => ({
        time: c.check_time,
        failed_checks: Object.entries(c.check_results?.checks || {})
          .filter(([_, check]: [string, any]) => check.status === 'error')
          .map(([name, check]: [string, any]) => ({
            name,
            message: check.message,
          })),
        alert_sent: c.alert_sent,
      }));

    return res.status(200).json({
      webhook_name: webhook,
      period_days: days,
      current_status: lastCheck?.overall_status || 'unknown',
      last_check_time: lastCheck?.check_time || null,
      stats: {
        total_checks: totalChecks,
        healthy_checks: healthyChecks,
        unhealthy_checks: unhealthyChecks,
        alerts_sent: alertsSent,
        uptime_percentage: uptime,
      },
      last_check_details: lastCheck?.check_results || null,
      recent_failures: recentFailures || [],
      all_checks: checks?.map(c => ({
        time: c.check_time,
        status: c.overall_status,
        alert_sent: c.alert_sent,
      })) || [],
    });

  } catch (error: any) {
    console.error('Error fetching webhook health status:', error);
    return res.status(500).json({
      error: 'Failed to fetch webhook health status',
      details: error.message,
    });
  }
}
