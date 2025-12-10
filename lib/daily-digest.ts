import { Resend } from 'resend';
import { generateDailyDigest, detectAnomalies, getAdminActionItems, AdminActionItems } from './monitoring';

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

    // Get admin action items (consolidated from removed cron jobs)
    const adminItems = await getAdminActionItems();

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

    // Build admin action items section
    let adminSection = '';

    // System health alerts (show first if issues)
    if (adminItems.systemHealth.issues.length > 0) {
      adminSection += `\n\n⚠️ SYSTEM HEALTH ISSUES\n`;
      adminItems.systemHealth.issues.forEach(issue => {
        adminSection += `  • ${issue}\n`;
      });
    }

    // Upcoming renewals (action items for admin)
    if (adminItems.upcomingRenewals.length > 0) {
      adminSection += `\n\n📋 ACTION REQUIRED: RENEWALS (${adminItems.upcomingRenewals.length} users)\n`;
      adminSection += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      // Group by urgency
      const urgent = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry <= 14);
      const soon = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry > 14 && r.daysUntilExpiry <= 21);
      const upcoming = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry > 21);

      if (urgent.length > 0) {
        adminSection += `\n🔴 URGENT (≤14 days): ${urgent.length}\n`;
        urgent.slice(0, 5).forEach(r => {
          adminSection += `  • ${r.firstName} ${r.lastName} (${r.email}) - ${r.daysUntilExpiry}d - ${r.licensePlate || 'No plate'}\n`;
        });
        if (urgent.length > 5) adminSection += `  ... and ${urgent.length - 5} more\n`;
      }

      if (soon.length > 0) {
        adminSection += `\n🟡 SOON (15-21 days): ${soon.length}\n`;
        soon.slice(0, 3).forEach(r => {
          adminSection += `  • ${r.firstName} ${r.lastName} (${r.email}) - ${r.daysUntilExpiry}d\n`;
        });
        if (soon.length > 3) adminSection += `  ... and ${soon.length - 3} more\n`;
      }

      if (upcoming.length > 0) {
        adminSection += `\n🔵 UPCOMING (22-30 days): ${upcoming.length} users\n`;
      }
    }

    // Missing permit docs
    if (adminItems.missingPermitDocs.length > 0) {
      adminSection += `\n\n🅿️ MISSING PERMIT DOCS (${adminItems.missingPermitDocs.length} users)\n`;
      adminSection += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      const critical = adminItems.missingPermitDocs.filter(d => d.urgency === 'critical');
      const urgentDocs = adminItems.missingPermitDocs.filter(d => d.urgency === 'urgent');

      if (critical.length > 0) {
        adminSection += `\n🔴 CRITICAL (≤14 days): ${critical.length}\n`;
        critical.forEach(d => {
          adminSection += `  • ${d.email} - ${d.daysRemaining}d - ${d.documentStatus}\n`;
        });
      }

      if (urgentDocs.length > 0) {
        adminSection += `\n🟡 URGENT (15-21 days): ${urgentDocs.length}\n`;
        urgentDocs.forEach(d => {
          adminSection += `  • ${d.email} - ${d.daysRemaining}d\n`;
        });
      }
    }

    const fullDigest = digest + anomaliesSection + adminSection;

    // Send via email
    if (options.email && resend) {
      const emails = Array.isArray(options.email) ? options.email : [options.email];

      // Build subject with alerts if needed
      let subject = `Daily Digest - ${new Date().toLocaleDateString()}`;
      const urgentRenewals = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry <= 14).length;
      const criticalDocs = adminItems.missingPermitDocs.filter(d => d.urgency === 'critical').length;
      if (urgentRenewals > 0 || criticalDocs > 0 || adminItems.systemHealth.issues.length > 0) {
        subject = `⚠️ ${subject}`;
        if (urgentRenewals > 0) subject += ` | ${urgentRenewals} urgent renewals`;
        if (criticalDocs > 0) subject += ` | ${criticalDocs} missing docs`;
      }

      try {
        const { error } = await resend.emails.send({
          from: process.env.RESEND_FROM || 'Autopilot America <alerts@autopilotamerica.com>',
          to: emails,
          subject,
          text: fullDigest,
          html: generateDigestHTML(fullDigest, stats, adminItems),
          replyTo: 'support@autopilotamerica.com'
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
function generateDigestHTML(digest: string, stats: any, adminItems?: AdminActionItems): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

  // Build admin action items HTML
  let adminHTML = '';

  if (adminItems) {
    // System health issues
    if (adminItems.systemHealth.issues.length > 0) {
      adminHTML += `
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 12px; color: #991b1b; font-size: 16px;">⚠️ System Health Issues</h3>
          <ul style="margin: 0; padding-left: 20px; color: #991b1b;">
            ${adminItems.systemHealth.issues.map(issue => `<li>${issue}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // Upcoming renewals
    if (adminItems.upcomingRenewals.length > 0) {
      const urgent = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry <= 14);
      const soon = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry > 14 && r.daysUntilExpiry <= 21);
      const upcoming = adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry > 21);

      adminHTML += `
        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 12px; color: #92400e; font-size: 16px;">📋 Renewals Needing Sticker Purchase (${adminItems.upcomingRenewals.length})</h3>
          ${urgent.length > 0 ? `
            <div style="background: #fee2e2; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
              <strong style="color: #991b1b;">🔴 URGENT (≤14 days): ${urgent.length}</strong>
              <table style="width: 100%; margin-top: 8px; font-size: 13px;">
                ${urgent.slice(0, 5).map(r => `
                  <tr>
                    <td style="padding: 4px 0; color: #991b1b;">${r.firstName} ${r.lastName}</td>
                    <td style="padding: 4px 8px; color: #991b1b;">${r.email}</td>
                    <td style="padding: 4px 0; color: #991b1b; font-weight: bold;">${r.daysUntilExpiry}d</td>
                    <td style="padding: 4px 0; color: #991b1b;">${r.licensePlate || '-'}</td>
                  </tr>
                `).join('')}
                ${urgent.length > 5 ? `<tr><td colspan="4" style="padding: 4px 0; color: #991b1b; font-style: italic;">... and ${urgent.length - 5} more</td></tr>` : ''}
              </table>
            </div>
          ` : ''}
          ${soon.length > 0 ? `
            <div style="background: #fef3c7; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
              <strong style="color: #92400e;">🟡 Soon (15-21 days): ${soon.length}</strong>
              <div style="margin-top: 8px; font-size: 13px; color: #92400e;">
                ${soon.slice(0, 3).map(r => `${r.firstName} ${r.lastName} (${r.daysUntilExpiry}d)`).join(', ')}
                ${soon.length > 3 ? `, +${soon.length - 3} more` : ''}
              </div>
            </div>
          ` : ''}
          ${upcoming.length > 0 ? `
            <div style="font-size: 13px; color: #78350f;">
              🔵 Upcoming (22-30 days): ${upcoming.length} users
            </div>
          ` : ''}
          <a href="${baseUrl}/admin/profile-updates" style="display: inline-block; margin-top: 12px; background: #f59e0b; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px;">View in Admin Panel</a>
        </div>
      `;
    }

    // Missing permit docs
    if (adminItems.missingPermitDocs.length > 0) {
      const critical = adminItems.missingPermitDocs.filter(d => d.urgency === 'critical');
      const urgentDocs = adminItems.missingPermitDocs.filter(d => d.urgency === 'urgent');

      adminHTML += `
        <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 12px; color: #1e40af; font-size: 16px;">🅿️ Missing Permit Zone Documents (${adminItems.missingPermitDocs.length})</h3>
          ${critical.length > 0 ? `
            <div style="background: #fee2e2; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
              <strong style="color: #991b1b;">🔴 CRITICAL (≤14 days): ${critical.length}</strong>
              <div style="margin-top: 8px; font-size: 13px; color: #991b1b;">
                ${critical.map(d => `${d.email} (${d.daysRemaining}d, ${d.documentStatus})`).join('<br>')}
              </div>
            </div>
          ` : ''}
          ${urgentDocs.length > 0 ? `
            <div style="background: #fef3c7; padding: 12px; border-radius: 6px;">
              <strong style="color: #92400e;">🟡 Urgent (15-21 days): ${urgentDocs.length}</strong>
              <div style="margin-top: 8px; font-size: 13px; color: #92400e;">
                ${urgentDocs.map(d => `${d.email} (${d.daysRemaining}d)`).join(', ')}
              </div>
            </div>
          ` : ''}
          <a href="${baseUrl}/admin-permit-documents" style="display: inline-block; margin-top: 12px; background: #3b82f6; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px;">Review Documents</a>
        </div>
      `;
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Digest</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">

  <div style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 28px;">📊 Daily Digest</h1>
    <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">${new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}</p>
  </div>

  <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 12px 12px;">

    ${adminHTML ? `
    <!-- Admin Action Items -->
    <div style="margin-bottom: 30px;">
      <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">🎯 Action Items</h2>
      ${adminHTML}
    </div>
    ` : ''}

    <!-- Messaging Stats -->
    <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">📨 Messaging Stats (24h)</h2>

    <!-- Stats Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 11px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">Sent</div>
        <div style="font-size: 28px; font-weight: bold;">${stats.sent}</div>
      </div>
      <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 11px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">Skipped</div>
        <div style="font-size: 28px; font-weight: bold;">${stats.skipped}</div>
      </div>
      <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 11px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">Errors</div>
        <div style="font-size: 28px; font-weight: bold;">${stats.errors}</div>
      </div>
      <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
        <div style="font-size: 11px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">Total</div>
        <div style="font-size: 28px; font-weight: bold;">${stats.total}</div>
      </div>
    </div>

    <!-- Full Digest Details -->
    <details style="margin-top: 20px;">
      <summary style="cursor: pointer; color: #6b7280; font-size: 14px;">View detailed breakdown</summary>
      <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-top: 12px;">
        <pre style="font-family: 'Courier New', monospace; font-size: 12px; margin: 0; white-space: pre-wrap;">${digest}</pre>
      </div>
    </details>

    <!-- Footer -->
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px;">
      <p style="margin: 0;">
        <a href="${baseUrl}/admin/message-audit" style="color: #2563eb;">Message Audit</a> |
        <a href="${baseUrl}/admin/profile-updates" style="color: #2563eb;">Admin Panel</a>
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
