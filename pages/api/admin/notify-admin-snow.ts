import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const ADMIN_EMAIL = 'ticketlessamerica@gmail.com';

interface NotifyAdminSnowParams {
  snowAmount: number;
  forecastPeriod: string;
  detailedForecast: string;
  eventId?: string;
  notificationType?: string;
  userStats?: any;
}

/**
 * Exportable function for direct calls (from cron jobs)
 */
export async function notifyAdminSnow(params: NotifyAdminSnowParams) {
  const { snowAmount, forecastPeriod, detailedForecast, eventId, notificationType, userStats } = params;

  if (!snowAmount || snowAmount < 2.0) {
    throw new Error('Snow amount must be >= 2 inches');
  }

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h1 style="color:#dc2626">🚨 2-Inch Snow Detected in Chicago</h1>

      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;margin:20px 0">
        <h2 style="margin:0 0 12px">${snowAmount}" of Snow Forecasted</h2>
        <p style="margin:0"><strong>Period:</strong> ${forecastPeriod}</p>
        <p style="margin:8px 0 0"><strong>Notification Type:</strong> ${notificationType || 'N/A'}</p>
      </div>

      <h3>Forecast Details:</h3>
      <p>${detailedForecast}</p>

      ${userStats ? `
      <div style="background:#d1fae5;border-left:4px solid #10b981;padding:16px;margin:20px 0">
        <h3 style="margin:0 0 12px">User Notifications Sent:</h3>
        <ul style="margin:0">
          <li>Users checked: ${userStats.usersChecked || 0}</li>
          <li>Users notified: ${userStats.usersNotified || 0}</li>
          <li>Emails sent: ${userStats.emailsSent || 0}</li>
          <li>SMS sent: ${userStats.smsSent || 0}</li>
          <li>Already notified (skipped): ${userStats.alreadyNotified || 0}</li>
        </ul>
      </div>
      ` : ''}

      <h3>⚠️ Action Required:</h3>
      <p>This triggers Chicago's 2-inch parking ban on ~500 miles of arterial streets.</p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">

      <p style="font-size:12px;color:#6b7280">
        This is an automated alert from your Autopilot America snow monitoring system.<br>
        Event ID: ${eventId || 'N/A'}<br>
        Detected at: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} (Chicago time)<br>
        Data source: National Weather Service (NWS) API
      </p>
    </div>
  `;

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    timeout: DEFAULT_TIMEOUTS.email,
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [ADMIN_EMAIL],
      subject: `🚨 2-Inch Snow Alert: ${snowAmount}" forecasted in Chicago`,
      html: emailHtml
    })
  });

  const emailResult = await response.json();

  if (!response.ok) {
    throw new Error(`Email failed: ${JSON.stringify(emailResult)}`);
  }

  return {
    success: true,
    emailSent: true,
    emailId: emailResult.id,
    adminEmail: ADMIN_EMAIL
  };
}

/**
 * API Handler for HTTP calls
 * Send admin notification when 2+ inches of snow detected
 */
export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { snowAmount, forecastPeriod, detailedForecast, eventId, notificationType, userStats } = req.body;

  try {
    const result = await notifyAdminSnow({
      snowAmount,
      forecastPeriod,
      detailedForecast,
      eventId,
      notificationType,
      userStats
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Admin snow notification failed:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
});

