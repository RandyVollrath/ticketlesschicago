import { Resend } from 'resend';
import { generateDailyDigest, detectAnomalies } from './monitoring';

/**
 * Daily Digest System
 *
 * Sends automated daily reports via email and/or Slack
 * Includes message stats, anomaly detection, and system health
 */

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface DigestOptions {
  email?: string | string[]; // Email address(es) to send to
  slackWebhook?: string; // Slack webhook URL
  includeAnomalies?: boolean; // Include anomaly detection (default: true)
}

/**
 * Send daily digest via email and/or Slack
 */
export async function sendDailyDigest(options: DigestOptions = {}): Promise<{
  success: boolean;
  emailSent: boolean;
  slackSent: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  let emailSent = false;
  let slackSent = false;

  try {
    // Generate digest content
    const { success, digest, stats } = await generateDailyDigest();

    if (!success) {
      errors.push('Failed to generate digest');
      return { success: false, emailSent, slackSent, errors };
    }

    // Get anomalies if requested
    let anomaliesSection = '';
    if (options.includeAnomalies !== false) {
      const { anomalies } = await detectAnomalies();

      if (anomalies.length > 0) {
        anomaliesSection = `\n\n🚨 ANOMALIES DETECTED\n\n`;
        anomalies.forEach((a) => {
          const icon = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🔵';
          anomaliesSection += `${icon} [${a.severity.toUpperCase()}] ${a.message}\n`;
        });
      }
    }

    const fullDigest = digest + anomaliesSection;

    // Send via email
    if (options.email && resend) {
      const emails = Array.isArray(options.email) ? options.email : [options.email];

      try {
        const { error } = await resend.emails.send({
          from: process.env.RESEND_FROM || 'Autopilot America <alerts@autopilotamerica.com>',
          to: emails,
          subject: `Daily Messaging Digest - ${new Date().toLocaleDateString()}`,
          text: fullDigest,
          html: generateDigestHTML(fullDigest, stats),
          reply_to: 'support@autopilotamerica.com'
        });

        if (error) {
          errors.push(`Email error: ${error.message}`);
        } else {
          emailSent = true;
        }
      } catch (error: any) {
        errors.push(`Email error: ${error.message}`);
      }
    } else if (options.email && !resend) {
      errors.push('Email requested but RESEND_API_KEY not configured');
    }

    // Send via Slack
    if (options.slackWebhook) {
      try {
        const response = await fetch(options.slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `📊 *Daily Messaging Digest* - ${new Date().toLocaleDateString()}`,
            blocks: generateSlackBlocks(digest, stats, anomaliesSection)
          })
        });

        if (!response.ok) {
          errors.push(`Slack error: ${response.statusText}`);
        } else {
          slackSent = true;
        }
      } catch (error: any) {
        errors.push(`Slack error: ${error.message}`);
      }
    }

    return {
      success: (emailSent || slackSent) && errors.length === 0,
      emailSent,
      slackSent,
      errors
    };
  } catch (error: any) {
    errors.push(`Fatal error: ${error.message}`);
    return { success: false, emailSent, slackSent, errors };
  }
}

/**
 * Generate HTML version of digest for email
 */
function generateDigestHTML(digest: string, stats: any): string {
  const lines = digest.split('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Messaging Digest</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">

  <div style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 28px;">📊 Daily Messaging Digest</h1>
    <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">${new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}</p>
  </div>

  <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 12px 12px;">

    <!-- Stats Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 30px;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 12px; text-transform: uppercase; opacity: 0.9; margin-bottom: 8px;">Sent</div>
        <div style="font-size: 32px; font-weight: bold;">${stats.sent}</div>
      </div>
      <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 20px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 12px; text-transform: uppercase; opacity: 0.9; margin-bottom: 8px;">Skipped</div>
        <div style="font-size: 32px; font-weight: bold;">${stats.skipped}</div>
      </div>
      <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 20px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 12px; text-transform: uppercase; opacity: 0.9; margin-bottom: 8px;">Errors</div>
        <div style="font-size: 32px; font-weight: bold;">${stats.errors}</div>
      </div>
      <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 20px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 12px; text-transform: uppercase; opacity: 0.9; margin-bottom: 8px;">Total</div>
        <div style="font-size: 32px; font-weight: bold;">${stats.total}</div>
      </div>
    </div>

    <!-- Full Digest -->
    <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-top: 20px;">
      <pre style="font-family: 'Courier New', monospace; font-size: 13px; margin: 0; white-space: pre-wrap;">${digest}</pre>
    </div>

    <!-- Footer -->
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px;">
      <p style="margin: 0;">
        View full details: <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com'}/admin/message-audit" style="color: #2563eb;">Message Audit Dashboard</a>
      </p>
      <p style="margin: 8px 0 0;">
        Questions? Contact <a href="mailto:support@autopilotamerica.com" style="color: #2563eb;">support@autopilotamerica.com</a>
      </p>
    </div>
  </div>

</body>
</html>
  `.trim();
}

/**
 * Generate Slack blocks for rich formatting
 */
function generateSlackBlocks(digest: string, stats: any, anomaliesSection: string): any[] {
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 Daily Messaging Digest - ${new Date().toLocaleDateString()}`
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Sent*\n${stats.sent}`
        },
        {
          type: 'mrkdwn',
          text: `*Skipped*\n${stats.skipped}`
        },
        {
          type: 'mrkdwn',
          text: `*Errors*\n${stats.errors}`
        },
        {
          type: 'mrkdwn',
          text: `*Total*\n${stats.total}`
        }
      ]
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```\n' + digest + '\n```'
      }
    }
  ];

  // Add anomalies if present
  if (anomaliesSection) {
    blocks.push({
      type: 'divider'
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: anomaliesSection
      }
    });
  }

  // Add actions
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Dashboard'
        },
        url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com'}/admin/message-audit`
      }
    ]
  });

  return blocks;
}

/**
 * Schedule daily digest (call this from cron or manually)
 */
export async function scheduleDailyDigest(): Promise<{
  success: boolean;
  message: string;
}> {
  const adminEmail = process.env.ADMIN_EMAIL || 'randy.vollrath@gmail.com';
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;

  const result = await sendDailyDigest({
    email: adminEmail,
    slackWebhook,
    includeAnomalies: true
  });

  if (result.success) {
    const channels = [];
    if (result.emailSent) channels.push('email');
    if (result.slackSent) channels.push('Slack');

    return {
      success: true,
      message: `Daily digest sent via ${channels.join(' and ')}`
    };
  } else {
    return {
      success: false,
      message: `Failed to send digest: ${result.errors.join(', ')}`
    };
  }
}
