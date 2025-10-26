import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * Generate preview of users who will receive winter ban notifications
 * Send this list to admin email 2 weeks before Nov 30
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all winter ban streets
    const { data: banStreets, error: streetsError } = await supabaseAdmin
      .from('winter_overnight_parking_ban_streets')
      .select('street_name, from_location, to_location');

    if (streetsError) throw streetsError;

    const streetNames = (banStreets || []).map(s => s.street_name.toLowerCase());

    // Get all users with notify_winter_ban enabled
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone_number, home_address_full, notify_winter_ban')
      .eq('notify_winter_ban', true)
      .not('home_address_full', 'is', null);

    if (usersError) throw usersError;

    const usersToNotify: any[] = [];
    const usersSkipped: any[] = [];

    // Check which users match winter ban streets
    for (const user of users || []) {
      if (!user.home_address_full) continue;

      const address = user.home_address_full.toLowerCase();
      const matchedStreet = streetNames.find(street =>
        address.includes(street.toLowerCase())
      );

      if (matchedStreet) {
        usersToNotify.push({
          email: user.email,
          phone: user.phone_number,
          address: user.home_address_full,
          matchedStreet: matchedStreet.toUpperCase()
        });
      } else {
        usersSkipped.push({
          email: user.email,
          address: user.home_address_full,
          reason: 'Address does not match any winter ban street'
        });
      }
    }

    // Generate HTML report
    const htmlReport = `
      <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">
        <h1>Winter Overnight Parking Ban - Notification Preview</h1>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Scheduled Send Date:</strong> November 30, 2025 at 9:00 AM</p>

        <h2>Summary</h2>
        <ul>
          <li>Total users opted in: ${(users || []).length}</li>
          <li>Users to notify: ${usersToNotify.length}</li>
          <li>Users skipped: ${usersSkipped.length}</li>
        </ul>

        <h2>⚠️ WARNING: Limited Street Data</h2>
        <p style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;">
          <strong>Only 22 street segments available</strong><br>
          Your FOIA data contains only 22 street segments, NOT the full 107 miles of winter ban streets.<br>
          Address matching is basic (searches for street name in address) and may have false positives/negatives.
        </p>

        <h2>Available Winter Ban Streets (22 segments)</h2>
        <table style="border-collapse:collapse;width:100%;margin:20px 0">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="border:1px solid #ddd;padding:8px;text-align:left">Street</th>
              <th style="border:1px solid #ddd;padding:8px;text-align:left">From</th>
              <th style="border:1px solid #ddd;padding:8px;text-align:left">To</th>
            </tr>
          </thead>
          <tbody>
            ${(banStreets || []).map(s => `
              <tr>
                <td style="border:1px solid #ddd;padding:8px">${s.street_name}</td>
                <td style="border:1px solid #ddd;padding:8px">${s.from_location}</td>
                <td style="border:1px solid #ddd;padding:8px">${s.to_location}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>Users Who Will Be Notified (${usersToNotify.length})</h2>
        <table style="border-collapse:collapse;width:100%;margin:20px 0">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="border:1px solid #ddd;padding:8px;text-align:left">Email</th>
              <th style="border:1px solid #ddd;padding:8px;text-align:left">Address</th>
              <th style="border:1px solid #ddd;padding:8px;text-align:left">Matched Street</th>
            </tr>
          </thead>
          <tbody>
            ${usersToNotify.map(u => `
              <tr>
                <td style="border:1px solid #ddd;padding:8px">${u.email}</td>
                <td style="border:1px solid #ddd;padding:8px">${u.address}</td>
                <td style="border:1px solid #ddd;padding:8px;background:#dcfce7">${u.matchedStreet}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${usersSkipped.length > 0 ? `
          <h2>Users Opted In But NOT Matched (${usersSkipped.length})</h2>
          <table style="border-collapse:collapse;width:100%;margin:20px 0">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="border:1px solid #ddd;padding:8px;text-align:left">Email</th>
                <th style="border:1px solid #ddd;padding:8px;text-align:left">Address</th>
                <th style="border:1px solid #ddd;padding:8px;text-align:left">Reason</th>
              </tr>
            </thead>
            <tbody>
              ${usersSkipped.map(u => `
                <tr>
                  <td style="border:1px solid #ddd;padding:8px">${u.email}</td>
                  <td style="border:1px solid #ddd;padding:8px">${u.address}</td>
                  <td style="border:1px solid #ddd;padding:8px;color:#dc2626">${u.reason}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        <h2>Recommendations</h2>
        <ol>
          <li>Review the matched addresses - verify they are actually on winter ban streets</li>
          <li>Check for false positives (e.g., "State St" might match "State Line Rd")</li>
          <li>Consider getting the complete 107-mile street list from the city</li>
          <li>If list looks good, notifications will send automatically Nov 30 at 9am</li>
        </ol>
      </div>
    `;

    // Send preview email to admin
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Autopilot America <noreply@ticketlessamerica.com>',
        to: ['ticketlessamerica@gmail.com'],
        subject: `Winter Ban Notification Preview - ${usersToNotify.length} users will be notified`,
        html: htmlReport
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
      summary: {
        totalOptedIn: (users || []).length,
        willBeNotified: usersToNotify.length,
        skipped: usersSkipped.length,
        availableStreets: (banStreets || []).length
      }
    });

  } catch (error) {
    console.error('Preview generation failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate preview',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
