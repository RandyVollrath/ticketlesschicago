import { NextApiRequest, NextApiResponse } from 'next';
import {
  getMessageStats,
  generateDailyDigest,
  detectAnomalies
} from '../../../lib/monitoring';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import {
  validateAllEnvGroups,
  getEnvDebugInfo,
  EnvGroup
} from '../../../lib/env-validation';
import {
  getAllCircuitStates,
  circuitBreakers,
  resetAllCircuits
} from '../../../lib/circuit-breaker';

/**
 * Monitoring API
 *
 * Get message statistics and daily digest
 *
 * Endpoints:
 * - GET /api/admin/monitoring?action=stats&days=7 - Get stats for last N days
 * - GET /api/admin/monitoring?action=digest - Generate daily digest
 * - GET /api/admin/monitoring?action=anomalies - Detect anomalies
 * - GET /api/admin/monitoring?action=env - Check environment variables
 * - GET /api/admin/monitoring?action=circuits - Check circuit breaker states
 * - POST /api/admin/monitoring?action=reset-circuits - Reset all circuit breakers
 */
export default withAdminAuth(async (req, res, adminUser) => {
  // Allow POST for reset-circuits action
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, days, userId } = req.query;

  try {
    switch (action) {
      case 'stats': {
        const daysNum = parseInt(days as string) || 1;
        const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
        const endDate = new Date();

        const stats = await getMessageStats({
          startDate,
          endDate,
          userId: userId as string | undefined
        });

        return res.status(200).json({
          success: true,
          period: {
            days: daysNum,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString()
          },
          stats,
          metrics: {
            success_rate: stats.total > 0 ? ((stats.sent / stats.total) * 100).toFixed(1) + '%' : '0%',
            error_rate: stats.total > 0 ? ((stats.errors / stats.total) * 100).toFixed(1) + '%' : '0%',
            skip_rate: stats.total > 0 ? ((stats.skipped / stats.total) * 100).toFixed(1) + '%' : '0%',
            avg_cost_per_message: stats.total > 0 ? `$${(stats.costTotal / stats.total / 100).toFixed(4)}` : '$0',
            total_cost: `$${(stats.costTotal / 100).toFixed(2)}`
          }
        });
      }

      case 'digest': {
        const { success, digest, stats } = await generateDailyDigest();

        return res.status(200).json({
          success,
          digest,
          stats,
          instructions: {
            send_email: 'You can email this digest to admin@autopilotamerica.com',
            slack_webhook: 'Or send to Slack webhook for daily notifications'
          }
        });
      }

      case 'anomalies': {
        const { anomalies } = await detectAnomalies();

        const hasHighSeverity = anomalies.some((a) => a.severity === 'high');
        const hasMediumSeverity = anomalies.some((a) => a.severity === 'medium');

        return res.status(200).json({
          success: true,
          anomalies,
          alert_level: hasHighSeverity ? 'high' : hasMediumSeverity ? 'medium' : 'low',
          message:
            anomalies.length === 0
              ? '✅ No anomalies detected'
              : `⚠️ ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'} detected`,
          recommendations: generateRecommendations(anomalies)
        });
      }

      case 'env': {
        // Environment variable health check
        const results = validateAllEnvGroups();
        const debugInfo = getEnvDebugInfo();

        const groups: Record<string, {
          valid: boolean;
          missing: string[];
          missingRecommended: string[];
          description: string;
        }> = {};

        let allValid = true;
        let totalMissing = 0;
        let totalMissingRecommended = 0;

        for (const [group, result] of results) {
          groups[group] = {
            valid: result.valid,
            missing: result.missing,
            missingRecommended: result.missingRecommended,
            description: result.description,
          };
          if (!result.valid) allValid = false;
          totalMissing += result.missing.length;
          totalMissingRecommended += result.missingRecommended.length;
        }

        return res.status(200).json({
          success: true,
          environment: {
            node_env: process.env.NODE_ENV || 'development',
            all_required_set: allValid,
            total_missing_required: totalMissing,
            total_missing_recommended: totalMissingRecommended,
          },
          groups,
          variables: debugInfo,
          message: allValid
            ? '✅ All required environment variables are set'
            : `❌ Missing ${totalMissing} required environment variable(s)`,
        });
      }

      case 'circuits': {
        // Circuit breaker health check
        const circuitStates = getAllCircuitStates();

        const hasOpenCircuits = Object.values(circuitStates).some(
          (c) => c.state === 'OPEN'
        );
        const hasHalfOpenCircuits = Object.values(circuitStates).some(
          (c) => c.state === 'HALF_OPEN'
        );

        return res.status(200).json({
          success: true,
          circuits: circuitStates,
          summary: {
            total: Object.keys(circuitStates).length,
            open: Object.values(circuitStates).filter((c) => c.state === 'OPEN').length,
            halfOpen: Object.values(circuitStates).filter((c) => c.state === 'HALF_OPEN').length,
            closed: Object.values(circuitStates).filter((c) => c.state === 'CLOSED').length,
          },
          alert_level: hasOpenCircuits ? 'high' : hasHalfOpenCircuits ? 'medium' : 'low',
          message: hasOpenCircuits
            ? '🚫 Some circuit breakers are OPEN - services may be degraded'
            : hasHalfOpenCircuits
            ? '⚠️ Some circuit breakers are testing recovery'
            : '✅ All circuit breakers healthy',
        });
      }

      case 'reset-circuits': {
        if (req.method !== 'POST') {
          return res.status(405).json({
            error: 'Use POST to reset circuit breakers',
          });
        }

        resetAllCircuits();

        return res.status(200).json({
          success: true,
          message: '✅ All circuit breakers have been reset',
          circuits: getAllCircuitStates(),
        });
      }

      default: {
        return res.status(400).json({
          error: 'Invalid action',
          available_actions: {
            stats: 'GET /api/admin/monitoring?action=stats&days=7',
            digest: 'GET /api/admin/monitoring?action=digest',
            anomalies: 'GET /api/admin/monitoring?action=anomalies',
            env: 'GET /api/admin/monitoring?action=env',
            circuits: 'GET /api/admin/monitoring?action=circuits',
            'reset-circuits': 'POST /api/admin/monitoring?action=reset-circuits',
          }
        });
      }
    }
  } catch (error: any) {
    console.error('Error in monitoring endpoint:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
});

/**
 * Generate recommendations based on anomalies
 */
function generateRecommendations(anomalies: any[]): string[] {
  const recommendations: string[] = [];

  anomalies.forEach((anomaly) => {
    switch (anomaly.type) {
      case 'error_spike':
        recommendations.push(
          'Check /admin/message-audit for error details',
          'Verify ClickSend/Resend API status',
          'Check recent code changes for bugs'
        );
        break;

      case 'volume_spike':
        recommendations.push(
          'Verify this is expected (new users, mass notification, etc.)',
          'Check costs - volume spike means higher spend',
          'Consider rate limiting if unexpected'
        );
        break;

      case 'skip_spike':
        recommendations.push(
          'Review skip reasons in /admin/message-audit',
          'Check if deduplication is working as expected',
          'Verify user preferences are correct'
        );
        break;

      case 'cost_spike':
        recommendations.push(
          'Review message volume - may be legitimate growth',
          'Check for duplicate sends (deduplication issue)',
          'Verify test users are cleaned up'
        );
        break;
    }
  });

  return [...new Set(recommendations)]; // Remove duplicates
}
