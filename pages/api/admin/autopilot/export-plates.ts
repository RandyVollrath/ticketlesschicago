/**
 * Admin endpoint to manually trigger plate export
 * POST /api/admin/autopilot/export-plates
 *
 * This calls the same logic as the cron job but can be triggered on-demand
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Chicago ticket search URL
const CHICAGO_TICKET_SEARCH_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

/**
 * Generate CSV content for VA
 */
function generateCSV(plates: any[]): string {
  const csvHeader = [
    'last_name',
    'first_name',
    'plate',
    'state',
    'user_id',
    'ticket_number',
    'violation_code',
    'violation_type',
    'violation_date',
    'amount'
  ].join(',');

  const instructions = `# AUTOPILOT AMERICA - PLATE CHECK TEMPLATE
# Generated: ${new Date().toISOString()}
# Total Plates: ${plates.length}
#
# CHICAGO TICKET SEARCH URL:
# ${CHICAGO_TICKET_SEARCH_URL}
#
# INSTRUCTIONS:
# 1. Go to the Chicago ticket search URL above
# 2. For each row, search by LAST NAME and LICENSE PLATE
# 3. If tickets are found, fill in columns F-J (ticket_number through amount)
# 4. If multiple tickets for one plate, duplicate that row
# 5. Leave ticket columns empty if no tickets found
# 6. Upload completed file to the Autopilot Admin portal
#
# Valid violation_type values: expired_plates, no_city_sticker, expired_meter, disabled_zone, street_cleaning, rush_hour, fire_hydrant, other_unknown
# violation_date format: YYYY-MM-DD
# amount format: numeric only (e.g., 75.00 not $75.00)
#
`;

  const csvRows = plates.map((p: any) => {
    return [
      `"${p.last_name || ''}"`,
      `"${p.first_name || ''}"`,
      `"${p.plate}"`,
      `"${p.state}"`,
      `"${p.user_id}"`,
      '', // ticket_number
      '', // violation_code
      '', // violation_type
      '', // violation_date
      '', // amount
    ].join(',');
  });

  return instructions + csvHeader + '\n' + csvRows.join('\n');
}

/**
 * Send email with CSV attachment via Resend
 */
async function sendEmailWithAttachment(
  to: string,
  subject: string,
  html: string,
  csvContent: string,
  filename: string
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  try {
    const csvBase64 = Buffer.from(csvContent).toString('base64');

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
        attachments: [
          {
            filename,
            content: csvBase64,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Resend error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('📋 Manual plate export triggered...');

  try {
    // Get VA email recipient from admin settings
    const { data: emailSetting } = await supabaseAdmin
      .from('autopilot_admin_settings')
      .select('value')
      .eq('key', 'va_email')
      .single();

    const vaEmail = emailSetting?.value?.email;

    if (!vaEmail) {
      return res.status(400).json({
        success: false,
        error: 'No VA email configured. Please set the VA email in Settings.',
      });
    }

    // Get users with active subscriptions
    const { data: activeSubscriptions, error: subError } = await supabaseAdmin
      .from('autopilot_subscriptions')
      .select('user_id')
      .eq('status', 'active');

    if (subError) throw subError;

    const activeUserIds = activeSubscriptions?.map(s => s.user_id) || [];

    if (activeUserIds.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'No active subscriptions found',
      });
    }

    // Get all active monitored plates from users with active subscriptions
    const { data: plates, error: platesError } = await supabaseAdmin
      .from('monitored_plates')
      .select('plate, state, user_id')
      .eq('status', 'active')
      .in('user_id', activeUserIds)
      .order('plate', { ascending: true });

    if (platesError) throw platesError;

    if (!plates || plates.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'No active plates to export',
      });
    }

    // Get user profiles to get first/last names
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name, full_name')
      .in('user_id', activeUserIds);

    // Create a map of user_id to profile
    const profileMap = new Map();
    profiles?.forEach(p => {
      profileMap.set(p.user_id, p);
    });

    // Merge plate data with profile data
    const platesWithNames = plates.map(plate => {
      const profile = profileMap.get(plate.user_id);
      let firstName = profile?.first_name || '';
      let lastName = profile?.last_name || '';

      if (!firstName && !lastName && profile?.full_name) {
        const nameParts = profile.full_name.trim().split(' ');
        firstName = nameParts[0] || '';
        lastName = nameParts.slice(1).join(' ') || '';
      }

      return {
        ...plate,
        first_name: firstName,
        last_name: lastName,
      };
    });

    // Generate CSV
    const csvContent = generateCSV(platesWithNames);
    const filename = `autopilot-plates-${new Date().toISOString().split('T')[0]}.csv`;

    // Email HTML
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">Autopilot Plate Check</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Manual Export - ${new Date().toLocaleDateString()}</p>
        </div>
        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <div style="background: #eff6ff; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
            <div style="font-size: 48px; font-weight: bold; color: #1e40af;">${plates.length}</div>
            <div style="color: #1e40af; font-size: 16px;">License Plates to Check</div>
          </div>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${CHICAGO_TICKET_SEARCH_URL}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Open Chicago Ticket Search
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            See attached CSV for the list of plates to check. Upload the completed file to the admin portal when done.
          </p>
        </div>
      </div>
    `;

    const subject = `Autopilot Plate Check - Manual Export - ${plates.length} plates`;

    // Send email
    const emailSent = await sendEmailWithAttachment(vaEmail, subject, html, csvContent, filename);

    // Log export job
    await supabaseAdmin
      .from('plate_export_jobs')
      .insert({
        plate_count: plates.length,
        status: emailSent ? 'complete' : 'failed',
        va_email: vaEmail,
        email_sent_to_va: emailSent,
        csv_url: null, // We don't store the CSV, just email it
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

    console.log(`✅ Manual export complete: ${plates.length} plates, email sent: ${emailSent}`);

    return res.status(200).json({
      success: emailSent,
      plateCount: plates.length,
      emailSent,
      recipientEmail: vaEmail,
      error: emailSent ? undefined : 'Failed to send email',
    });

  } catch (error: any) {
    console.error('Export error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to export plates',
    });
  }
}
