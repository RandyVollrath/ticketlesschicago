import { NextApiRequest, NextApiResponse } from 'next';
import { sendDailyDigest, scheduleDailyDigest } from '../../../lib/daily-digest';

/**
 * Send Daily Digest
 *
 * Sends automated daily messaging report via email and/or Slack
 * Can be called manually or via cron
 *
 * POST /api/admin/send-daily-digest
 *
 * Query params:
 * - email: Override email address (optional)
 * - slack: Slack webhook URL (optional)
 * - includeAnomalies: Include anomaly detection (default: true)
 * - useDefault: Use default recipients from env vars (default: true)
 *
 * Examples:
 * - POST /api/admin/send-daily-digest (sends to default admin email + Slack)
 * - POST /api/admin/send-daily-digest?email=custom@example.com
 * - POST /api/admin/send-daily-digest?slack=https://hooks.slack.com/...
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, slack, includeAnomalies, useDefault } = req.query;

    // If useDefault is true (or not specified), use scheduled digest
    if (useDefault !== 'false') {
      const result = await scheduleDailyDigest();

      return res.status(result.success ? 200 : 500).json({
        success: result.success,
        message: result.message
      });
    }

    // Otherwise, send custom digest
    const result = await sendDailyDigest({
      email: email as string | undefined,
      slackWebhook: slack as string | undefined,
      includeAnomalies: includeAnomalies !== 'false'
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send digest',
        details: result.errors,
        emailSent: result.emailSent,
        slackSent: result.slackSent
      });
    }

    const channels = [];
    if (result.emailSent) channels.push('email');
    if (result.slackSent) channels.push('Slack');

    return res.status(200).json({
      success: true,
      message: `Daily digest sent successfully via ${channels.join(' and ')}`,
      emailSent: result.emailSent,
      slackSent: result.slackSent,
      instructions: {
        setup: [
          '1. Set ADMIN_EMAIL in environment variables for default email',
          '2. Set SLACK_WEBHOOK_URL for Slack integration (optional)',
          '3. Schedule cron job: POST /api/admin/send-daily-digest daily at 9am'
        ],
        cron_example: 'vercel.json: { "crons": [{ "path": "/api/admin/send-daily-digest", "schedule": "0 9 * * *" }] }',
        manual_trigger: 'curl -X POST https://autopilotamerica.com/api/admin/send-daily-digest',
        custom_email: 'curl -X POST "https://autopilotamerica.com/api/admin/send-daily-digest?email=custom@example.com&useDefault=false"'
      }
    });
  } catch (error: any) {
    console.error('Error sending daily digest:', error);
    return res.status(500).json({
      error: 'Failed to send digest',
      message: error.message
    });
  }
}
