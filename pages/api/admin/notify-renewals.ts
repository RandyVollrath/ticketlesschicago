import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { notificationService } from '../../../lib/notifications';

const ADMIN_EMAILS = ['randyvollrath@gmail.com', 'carenvollrath@gmail.com'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // This endpoint should be called by a cron job
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET || 'dev-secret';

    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get renewals due in 30 days
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const thirtyDaysStr = thirtyDaysFromNow.toISOString().split('T')[0];

    const { data: renewals, error } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, license_plate, city_sticker_expiry, license_plate_expiry, phone')
      .or(`city_sticker_expiry.eq.${thirtyDaysStr},license_plate_expiry.eq.${thirtyDaysStr}`)
      .order('email', { ascending: true });

    if (error) throw error;

    if (!renewals || renewals.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No renewals due in 30 days',
        count: 0
      });
    }

    // Group renewals by type
    const cityStickerRenewals = renewals.filter(r => r.city_sticker_expiry === thirtyDaysStr);
    const licensePlateRenewals = renewals.filter(r => r.license_plate_expiry === thirtyDaysStr);

    // Build email content
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: #dc2626; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">🚨 Renewals Due in 30 Days</h1>
          <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">Action Required - Time to Purchase Stickers</p>
        </div>

        <!-- Main Content -->
        <div style="padding: 32px 24px; background: #ffffff;">
          <p style="color: #111827; font-size: 16px; margin: 0 0 24px;">
            The following renewals are due in <strong>30 days</strong> (${thirtyDaysFromNow.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })}).
            It's time to purchase stickers on behalf of these users.
          </p>

          ${cityStickerRenewals.length > 0 ? `
          <!-- City Stickers -->
          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
            <h2 style="margin: 0 0 16px; color: #92400e; font-size: 18px;">🏙️ City Stickers (${cityStickerRenewals.length})</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 2px solid #f59e0b;">
                  <th style="padding: 8px; text-align: left; color: #92400e; font-weight: 600;">Name</th>
                  <th style="padding: 8px; text-align: left; color: #92400e; font-weight: 600;">Email</th>
                  <th style="padding: 8px; text-align: left; color: #92400e; font-weight: 600;">License Plate</th>
                  <th style="padding: 8px; text-align: left; color: #92400e; font-weight: 600;">Phone</th>
                </tr>
              </thead>
              <tbody>
                ${cityStickerRenewals.map(r => `
                <tr style="border-bottom: 1px solid #fde68a;">
                  <td style="padding: 8px; color: #92400e;">${r.first_name} ${r.last_name}</td>
                  <td style="padding: 8px; color: #92400e;">${r.email}</td>
                  <td style="padding: 8px; color: #92400e; font-weight: 600;">${r.license_plate || '-'}</td>
                  <td style="padding: 8px; color: #92400e; font-size: 13px;">${r.phone || '-'}</td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${licensePlateRenewals.length > 0 ? `
          <!-- License Plates -->
          <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
            <h2 style="margin: 0 0 16px; color: #1e40af; font-size: 18px;">🚗 License Plate Stickers (${licensePlateRenewals.length})</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 2px solid #3b82f6;">
                  <th style="padding: 8px; text-align: left; color: #1e40af; font-weight: 600;">Name</th>
                  <th style="padding: 8px; text-align: left; color: #1e40af; font-weight: 600;">Email</th>
                  <th style="padding: 8px; text-align: left; color: #1e40af; font-weight: 600;">License Plate</th>
                  <th style="padding: 8px; text-align: left; color: #1e40af; font-weight: 600;">Phone</th>
                </tr>
              </thead>
              <tbody>
                ${licensePlateRenewals.map(r => `
                <tr style="border-bottom: 1px solid #bfdbfe;">
                  <td style="padding: 8px; color: #1e40af;">${r.first_name} ${r.last_name}</td>
                  <td style="padding: 8px; color: #1e40af;">${r.email}</td>
                  <td style="padding: 8px; color: #1e40af; font-weight: 600;">${r.license_plate || '-'}</td>
                  <td style="padding: 8px; color: #1e40af; font-size: 13px;">${r.phone || '-'}</td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          <!-- Action Items -->
          <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #374151; margin: 0 0 12px; font-size: 16px;">📋 Next Steps:</h3>
            <ol style="color: #6b7280; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Purchase stickers on behalf of these users</li>
              <li>Go to the <a href="https://ticketlessamerica.com/admin/profile-updates" style="color: #2563eb; text-decoration: none;">admin panel</a></li>
              <li>Select the users and send "sticker purchased" notifications</li>
              <li>Mark them as notified in the system</li>
            </ol>
          </div>

          <!-- Dashboard Link -->
          <div style="text-align: center; margin: 32px 0;">
            <a href="https://ticketlessamerica.com/admin/profile-updates"
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
              Go to Admin Panel
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
          <strong style="color: #374151;">Autopilot America - Admin Notification</strong><br>
          Automated daily renewal check
        </div>
      </div>
    `;

    const emailText = `
RENEWALS DUE IN 30 DAYS - ${thirtyDaysFromNow.toLocaleDateString()}

${cityStickerRenewals.length > 0 ? `
CITY STICKERS (${cityStickerRenewals.length}):
${cityStickerRenewals.map(r => `- ${r.first_name} ${r.last_name} (${r.email}) - Plate: ${r.license_plate || 'N/A'}`).join('\n')}
` : ''}

${licensePlateRenewals.length > 0 ? `
LICENSE PLATE STICKERS (${licensePlateRenewals.length}):
${licensePlateRenewals.map(r => `- ${r.first_name} ${r.last_name} (${r.email}) - Plate: ${r.license_plate || 'N/A'}`).join('\n')}
` : ''}

NEXT STEPS:
1. Purchase stickers on behalf of these users
2. Go to: https://ticketlessamerica.com/admin/profile-updates
3. Select users and send "sticker purchased" notifications
4. Mark them as notified in the system

---
Autopilot America - Admin Notification
    `;

    // Send email to all admins
    let emailsSent = 0;
    for (const adminEmail of ADMIN_EMAILS) {
      try {
        const sent = await notificationService.sendEmail({
          to: adminEmail,
          subject: `🚨 ${renewals.length} Renewals Due in 30 Days - Action Required`,
          html: emailHtml,
          text: emailText
        });
        if (sent) emailsSent++;
      } catch (error) {
        console.error(`Failed to send to ${adminEmail}:`, error);
      }
    }

    return res.status(200).json({
      success: true,
      count: renewals.length,
      cityStickerCount: cityStickerRenewals.length,
      licensePlateCount: licensePlateRenewals.length,
      emailsSent,
      dueDate: thirtyDaysStr
    });

  } catch (error) {
    console.error('Error in notify-renewals:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
