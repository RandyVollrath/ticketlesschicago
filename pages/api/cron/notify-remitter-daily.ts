/**
 * Daily Remitter Digest Cron Job
 *
 * Sends a morning digest email to all active remitters with:
 * - Count of users ready for renewal (profile confirmed)
 * - Urgent renewals (deadline <7 days)
 * - List of pending renewals
 * - Direct link to portal
 *
 * Schedule: Daily at 8am CT (14:00 UTC)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface DigestResult {
  success: boolean;
  remittersNotified: number;
  errors: string[];
}

/**
 * Send email via Resend
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [to],
        subject,
        html,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DigestResult | { error: string }>
) {
  // Verify cron authorization
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📬 Starting daily remitter digest...');

  const results: DigestResult = {
    success: true,
    remittersNotified: 0,
    errors: [],
  };

  try {
    // Get all active remitters with notification emails
    const { data: remitters, error: remitterError } = await supabase
      .from('renewal_partners')
      .select('id, name, email, notification_email')
      .eq('status', 'active');

    if (remitterError) {
      throw remitterError;
    }

    if (!remitters || remitters.length === 0) {
      console.log('No active remitters found');
      return res.status(200).json(results);
    }

    // Get Protection users data for the digest
    const today = new Date();
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const currentYear = today.getFullYear();

    // Users ready for renewal (profile confirmed for current year)
    const { data: confirmedUsers, error: confirmedError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, license_plate, profile_confirmed_at, city_sticker_expiry')
      .eq('has_contesting', true)
      .eq('profile_confirmed_for_year', currentYear)
      .is('sticker_purchased_at', null); // Not yet purchased

    if (confirmedError) {
      console.error('Error fetching confirmed users:', confirmedError);
    }

    // Users with urgent deadlines (sticker expires within 7 days)
    const { data: urgentUsers, error: urgentError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, license_plate, city_sticker_expiry')
      .eq('has_contesting', true)
      .is('sticker_purchased_at', null)
      .lte('city_sticker_expiry', sevenDaysFromNow.toISOString().split('T')[0])
      .gte('city_sticker_expiry', today.toISOString().split('T')[0]);

    if (urgentError) {
      console.error('Error fetching urgent users:', urgentError);
    }

    // All pending Protection users (not yet purchased)
    const { data: allPendingUsers, error: pendingError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, license_plate, city_sticker_expiry, profile_confirmed_for_year, license_image_path')
      .eq('has_contesting', true)
      .is('sticker_purchased_at', null)
      .order('city_sticker_expiry', { ascending: true });

    if (pendingError) {
      console.error('Error fetching pending users:', pendingError);
    }

    const readyCount = confirmedUsers?.length || 0;
    const urgentCount = urgentUsers?.length || 0;
    const totalPending = allPendingUsers?.length || 0;

    // Skip if nothing to report
    if (totalPending === 0) {
      console.log('No pending renewals to report');
      return res.status(200).json(results);
    }

    // Send digest to each remitter
    for (const remitter of remitters) {
      const email = remitter.notification_email || remitter.email;
      if (!email) {
        console.log(`Skipping remitter ${remitter.name} - no email`);
        continue;
      }

      const subject = urgentCount > 0
        ? `🚨 ${urgentCount} Urgent Renewal${urgentCount > 1 ? 's' : ''} - Daily Digest`
        : `📋 Daily Renewal Digest - ${totalPending} Pending`;

      const html = generateDigestEmail({
        remitterName: remitter.name,
        readyCount,
        urgentCount,
        totalPending,
        urgentUsers: urgentUsers || [],
        confirmedUsers: confirmedUsers || [],
        allPendingUsers: allPendingUsers || [],
        currentYear,
      });

      const sent = await sendEmail(email, subject, html);

      if (sent) {
        results.remittersNotified++;
        console.log(`✅ Sent digest to ${remitter.name} (${email})`);
      } else {
        results.errors.push(`Failed to send to ${remitter.name}`);
      }
    }

    console.log('✅ Daily remitter digest complete');
    console.log(`   Remitters notified: ${results.remittersNotified}`);

    return res.status(200).json(results);

  } catch (error: any) {
    console.error('Digest cron error:', error);
    results.success = false;
    results.errors.push(sanitizeErrorMessage(error));
    return res.status(500).json(results);
  }
}

interface DigestEmailData {
  remitterName: string;
  readyCount: number;
  urgentCount: number;
  totalPending: number;
  urgentUsers: any[];
  confirmedUsers: any[];
  allPendingUsers: any[];
  currentYear: number;
}

function generateDigestEmail(data: DigestEmailData): string {
  const { remitterName, readyCount, urgentCount, totalPending, urgentUsers, confirmedUsers, allPendingUsers, currentYear } = data;

  const urgentSection = urgentCount > 0 ? `
    <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <h2 style="margin: 0 0 12px; color: #991b1b; font-size: 18px;">🚨 Urgent - Deadline Within 7 Days (${urgentCount})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #fee2e2;">
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #fca5a5;">Name</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #fca5a5;">Plate</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #fca5a5;">Deadline</th>
        </tr>
        ${urgentUsers.slice(0, 10).map(u => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #fecaca;">${u.first_name || ''} ${u.last_name || ''}</td>
            <td style="padding: 8px; border-bottom: 1px solid #fecaca; font-weight: bold;">${u.license_plate || 'N/A'}</td>
            <td style="padding: 8px; border-bottom: 1px solid #fecaca; color: #dc2626;">${u.city_sticker_expiry || 'Unknown'}</td>
          </tr>
        `).join('')}
      </table>
      ${urgentCount > 10 ? `<p style="margin: 12px 0 0; color: #991b1b;">+ ${urgentCount - 10} more urgent renewals</p>` : ''}
    </div>
  ` : '';

  const readySection = readyCount > 0 ? `
    <div style="background: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <h2 style="margin: 0 0 12px; color: #166534; font-size: 18px;">✅ Ready to Process (${readyCount})</h2>
      <p style="margin: 0 0 12px; color: #166534;">These users have confirmed their ${currentYear} profile - ready for renewal!</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #dcfce7;">
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #86efac;">Name</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #86efac;">Email</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #86efac;">Plate</th>
        </tr>
        ${confirmedUsers.slice(0, 10).map(u => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #bbf7d0;">${u.first_name || ''} ${u.last_name || ''}</td>
            <td style="padding: 8px; border-bottom: 1px solid #bbf7d0;">${u.email}</td>
            <td style="padding: 8px; border-bottom: 1px solid #bbf7d0; font-weight: bold;">${u.license_plate || 'N/A'}</td>
          </tr>
        `).join('')}
      </table>
      ${readyCount > 10 ? `<p style="margin: 12px 0 0; color: #166534;">+ ${readyCount - 10} more ready</p>` : ''}
    </div>
  ` : '';

  const pendingSection = `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <h2 style="margin: 0 0 12px; color: #374151; font-size: 18px;">📋 All Pending Renewals (${totalPending})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #f3f4f6;">
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #d1d5db;">Name</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #d1d5db;">Plate</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #d1d5db;">Status</th>
          <th style="padding: 8px; text-align: left; border-bottom: 1px solid #d1d5db;">Has License</th>
        </tr>
        ${allPendingUsers.slice(0, 15).map(u => {
          const isConfirmed = u.profile_confirmed_for_year === currentYear;
          const hasLicense = !!u.license_image_path;
          return `
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${u.first_name || ''} ${u.last_name || ''}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">${u.license_plate || 'N/A'}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
                <span style="padding: 2px 8px; border-radius: 12px; font-size: 12px; ${isConfirmed ? 'background: #dcfce7; color: #166534;' : 'background: #fef3c7; color: #92400e;'}">
                  ${isConfirmed ? 'Confirmed' : 'Awaiting Confirmation'}
                </span>
              </td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
                ${hasLicense ? '✅' : '❌'}
              </td>
            </tr>
          `;
        }).join('')}
      </table>
      ${totalPending > 15 ? `<p style="margin: 12px 0 0; color: #6b7280;">+ ${totalPending - 15} more pending renewals</p>` : ''}
    </div>
  `;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">Good Morning, ${remitterName}!</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">Here's your daily renewal digest for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>

      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none;">
        <!-- Summary Stats -->
        <div style="display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 120px; background: #eff6ff; padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 32px; font-weight: bold; color: #1e40af;">${totalPending}</div>
            <div style="color: #1e40af; font-size: 14px;">Total Pending</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f0fdf4; padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 32px; font-weight: bold; color: #166534;">${readyCount}</div>
            <div style="color: #166534; font-size: 14px;">Ready to Process</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #fef2f2; padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 32px; font-weight: bold; color: #991b1b;">${urgentCount}</div>
            <div style="color: #991b1b; font-size: 14px;">Urgent (<7 days)</div>
          </div>
        </div>

        ${urgentSection}
        ${readySection}
        ${pendingSection}

        <!-- CTA Button -->
        <div style="text-align: center; margin-top: 24px;">
          <a href="https://autopilotamerica.com/remitter-portal"
             style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Open Remitter Portal
          </a>
        </div>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          You're receiving this because you're an active remitter for Autopilot America.<br>
          Questions? Contact support@autopilotamerica.com
        </p>
      </div>
    </div>
  `;
}
