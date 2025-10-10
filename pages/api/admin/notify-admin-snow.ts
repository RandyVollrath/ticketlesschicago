import type { NextApiRequest, NextApiResponse } from 'next';

const ADMIN_EMAIL = 'ticketlessamerica@gmail.com';

/**
 * Send admin notification when 2+ inches of snow detected
 * Called by the snow monitoring cron
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { snowAmount, forecastPeriod, detailedForecast, eventId } = req.body;

  if (!snowAmount || snowAmount < 2.0) {
    return res.status(400).json({ error: 'Snow amount must be >= 2 inches' });
  }

  try {
    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
        <h1 style="color:#dc2626">🚨 2-Inch Snow Detected in Chicago</h1>

        <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;margin:20px 0">
          <h2 style="margin:0 0 12px">${snowAmount}" of Snow Forecasted</h2>
          <p style="margin:0"><strong>Period:</strong> ${forecastPeriod}</p>
        </div>

        <h3>Forecast Details:</h3>
        <p>${detailedForecast}</p>

        <h3>⚠️ Action Required:</h3>
        <p>This triggers Chicago's 2-inch parking ban on ~500 miles of arterial streets.</p>

        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:20px 0">
          <strong>Current Status:</strong>
          <ul style="margin:8px 0">
            <li>✅ Snow event recorded in database (ID: ${eventId || 'N/A'})</li>
            <li>❌ User notifications NOT sent (no street data available)</li>
            <li>⏳ Waiting for 2-inch ban street list from FOIA</li>
          </ul>
        </div>

        <h3>What Happens Next:</h3>
        <ol>
          <li><strong>Monitor forecast:</strong> Snow amounts may change</li>
          <li><strong>Wait for FOIA data:</strong> Once you have the 2-inch ban street list, upload it</li>
          <li><strong>Enable notifications:</strong> System will then notify affected users automatically</li>
        </ol>

        <h3>Manual Actions You Can Take:</h3>
        <ul>
          <li>Post update on social media about 2-inch ban</li>
          <li>Send manual email to all users (if needed)</li>
          <li>Check city website: <a href="https://www.chicago.gov/city/en/depts/streets/provdrs/streets_san/svcs/winter_snow_parking_restrictions.html">Chicago.gov Winter Parking</a></li>
        </ul>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">

        <p style="font-size:12px;color:#6b7280">
          This is an automated alert from your Ticketless America snow monitoring system.<br>
          Detected at: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} (Chicago time)<br>
          Data source: National Weather Service (NWS) API
        </p>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Ticketless America <noreply@ticketlessamerica.com>',
        to: [ADMIN_EMAIL],
        subject: `🚨 2-Inch Snow Alert: ${snowAmount}" forecasted in Chicago`,
        html: emailHtml
      })
    });

    const emailResult = await response.json();

    if (!response.ok) {
      throw new Error(`Email failed: ${JSON.stringify(emailResult)}`);
    }

    return res.status(200).json({
      success: true,
      emailSent: true,
      emailId: emailResult.id,
      adminEmail: ADMIN_EMAIL
    });

  } catch (error) {
    console.error('Admin snow notification failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send admin notification',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
