/**
 * Monitor Utility Bills Webhook Health
 *
 * Runs daily to verify the webhook is working correctly.
 * Sends alert email if any checks fail.
 *
 * Scheduled: Daily at 8am CT (14:00 UTC)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('🏥 Running utility bills webhook health check...');

  try {
    // Call the health check endpoint
    const healthCheckUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/health/utility-bills`
      : 'https://www.ticketlesschicago.com/api/health/utility-bills';

    const response = await fetch(healthCheckUrl);
    const healthData = await response.json();

    console.log('Health check result:', JSON.stringify(healthData, null, 2));

    // If unhealthy, send alert email
    if (healthData.overall_status !== 'healthy') {
      console.error('❌ Utility bills webhook is UNHEALTHY!');

      const failedChecks = Object.entries(healthData.checks)
        .filter(([_, check]: [string, any]) => check.status === 'error')
        .map(([name, check]: [string, any]) => `- **${name}**: ${check.message}`)
        .join('\n');

      // Send alert email to admin
      await resend.emails.send({
        from: 'alerts@ticketlesschicago.com',
        to: process.env.ADMIN_EMAIL || 'randyvollrath@gmail.com',
        subject: '🚨 Utility Bills Webhook Health Check Failed',
        html: `
          <h2>Utility Bills Webhook Health Check Failed</h2>
          <p><strong>Status:</strong> ${healthData.overall_status}</p>
          <p><strong>Time:</strong> ${healthData.timestamp}</p>

          <h3>Failed Checks:</h3>
          ${failedChecks}

          <h3>All Check Results:</h3>
          <pre>${JSON.stringify(healthData.checks, null, 2)}</pre>

          <hr>
          <p><a href="https://www.ticketlesschicago.com/api/health/utility-bills">View Health Check</a></p>
          <p><a href="https://resend.com/webhooks">Check Resend Webhooks</a></p>
          <p><a href="https://vercel.com/ticketless-chicago/settings/domains">Check Vercel Domains</a></p>
        `,
      });

      console.log('📧 Alert email sent to admin');
    } else {
      console.log('✅ All checks passed - webhook is healthy');
    }

    return res.status(200).json({
      success: true,
      health_status: healthData.overall_status,
      timestamp: new Date().toISOString(),
      checks_run: Object.keys(healthData.checks).length,
      alert_sent: healthData.overall_status !== 'healthy',
    });

  } catch (error: any) {
    console.error('Error running health check:', error);

    // Send alert about the monitoring failure
    try {
      await resend.emails.send({
        from: 'alerts@ticketlesschicago.com',
        to: process.env.ADMIN_EMAIL || 'randyvollrath@gmail.com',
        subject: '🚨 Utility Bills Webhook Monitoring Failed',
        html: `
          <h2>Failed to Run Utility Bills Webhook Health Check</h2>
          <p><strong>Error:</strong> ${error.message}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>

          <p>The automated health check for the utility bills webhook failed to run.</p>
          <p>Please check the cron job and health check endpoint manually.</p>

          <hr>
          <p><a href="https://www.ticketlesschicago.com/api/health/utility-bills">View Health Check</a></p>
          <p><a href="https://vercel.com/ticketless-chicago/deployments">View Vercel Deployments</a></p>
        `,
      });
    } catch (emailError) {
      console.error('Failed to send alert email:', emailError);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
