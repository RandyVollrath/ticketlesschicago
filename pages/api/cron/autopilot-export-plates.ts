/**
 * Autopilot Plate Export Cron Job
 *
 * Sends a CSV of all monitored plates to the configured VA email.
 * The VA fills in ticket information and uploads the results.
 *
 * Schedule: Monday and Thursday at 8am Chicago time (14:00 UTC / 13:00 UTC during DST)
 *
 * Vercel cron: 0 14 * * 1,4  (Monday and Thursday at 2pm UTC = 8am CT)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ExportResult {
  success: boolean;
  plateCount: number;
  emailSent: boolean;
  recipientEmail: string | null;
  error?: string;
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
    // Resend accepts base64 encoded attachments
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

// Chicago ticket search URL
const CHICAGO_TICKET_SEARCH_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

/**
 * Generate CSV content for VA
 * Includes: last_name, plate, state (required for VA to search)
 * Plus: first_name, user_id for reference
 */
function generateCSV(plates: any[]): string {
  // CSV header - last_name, plate, state are the key fields for searching
  const csvHeader = [
    'last_name',
    'first_name',
    'plate',
    'state',
    'user_id',
    'ticket_number',
    'violation_code',
    'violation_type',
    'violation_description',
    'violation_date',
    'amount',
    'location'
  ].join(',');

  // Instructions for VA (as comments)
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
# 3. If tickets are found, fill in columns F-L (ticket_number through location)
# 4. If multiple tickets for one plate, duplicate that row
# 5. Leave ticket columns empty if no tickets found
# 6. Upload completed file to the Autopilot Admin portal
#
# KEY COLUMNS FOR SEARCHING:
# - last_name (Column A) - Use this for the name search
# - plate (Column C) - Use this for the license plate search
# - state (Column D) - License plate state
#
# Valid violation_type values: expired_plates, no_city_sticker, expired_meter, disabled_zone, street_cleaning, rush_hour, fire_hydrant, other_unknown
# violation_date format: YYYY-MM-DD
# amount format: numeric only (e.g., 75.00 not $75.00)
#
`;

  // Generate CSV rows - pre-fill user/plate info, leave ticket columns empty
  const csvRows = plates.map((p: any) => {
    return [
      `"${p.last_name || ''}"`,
      `"${p.first_name || ''}"`,
      `"${p.plate}"`,
      `"${p.state}"`,
      `"${p.user_id}"`,
      '', // ticket_number - VA fills this
      '', // violation_code
      '', // violation_type
      '', // violation_description
      '', // violation_date (YYYY-MM-DD format)
      '', // amount (numeric, no $ sign)
      '', // location
    ].join(',');
  });

  return instructions + csvHeader + '\n' + csvRows.join('\n');
}

/**
 * Generate email HTML
 */
function generateEmailHTML(plateCount: number, dayOfWeek: string): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">Autopilot Plate Check - ${dayOfWeek}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${dayOfWeek} Export - ${today}</p>
      </div>

      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <div style="background: #eff6ff; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 48px; font-weight: bold; color: #1e40af;">${plateCount}</div>
          <div style="color: #1e40af; font-size: 16px;">License Plates to Check</div>
        </div>

        <!-- Quick Action Button -->
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${CHICAGO_TICKET_SEARCH_URL}"
             style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Open Chicago Ticket Search
          </a>
        </div>

        <h2 style="margin: 0 0 16px; color: #374151; font-size: 18px;">Instructions:</h2>
        <ol style="color: #4b5563; line-height: 1.8; padding-left: 20px;">
          <li>Download the attached CSV file</li>
          <li>Go to the <a href="${CHICAGO_TICKET_SEARCH_URL}" style="color: #2563eb; font-weight: 600;">Chicago Ticket Search</a></li>
          <li>For each row, search by <strong>Last Name</strong> (Column A) and <strong>License Plate</strong> (Column C)</li>
          <li>If tickets are found, fill in columns F-L (ticket_number through location)</li>
          <li>If multiple tickets exist for one plate, duplicate that row</li>
          <li>Leave ticket columns empty if no tickets found</li>
          <li>Upload the completed file to the <a href="https://autopilotamerica.com/admin/autopilot" style="color: #2563eb;">Autopilot Admin portal</a></li>
        </ol>

        <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin-top: 20px;">
          <p style="margin: 0; color: #92400e; font-size: 14px;">
            <strong>Valid violation types:</strong> expired_plates, no_city_sticker, expired_meter, disabled_zone, street_cleaning, rush_hour, fire_hydrant, other_unknown
          </p>
        </div>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          This is an automated email from Autopilot America.<br>
          Questions? Contact support@autopilotamerica.com
        </p>
      </div>
    </div>
  `;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExportResult>
) {
  // Verify cron authorization
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({
      success: false,
      plateCount: 0,
      emailSent: false,
      recipientEmail: null,
      error: 'Unauthorized',
    });
  }

  console.log('📋 Starting autopilot plate export...');

  try {
    // Get VA email recipient from admin settings
    const { data: emailSetting } = await supabase
      .from('autopilot_admin_settings')
      .select('value')
      .eq('key', 'va_email_recipient')
      .single();

    const vaEmail = emailSetting?.value?.email;

    if (!vaEmail) {
      console.log('No VA email configured, skipping export');
      return res.status(200).json({
        success: true,
        plateCount: 0,
        emailSent: false,
        recipientEmail: null,
        error: 'No VA email recipient configured',
      });
    }

    // First get users with active subscriptions
    const { data: activeSubscriptions, error: subError } = await supabase
      .from('autopilot_subscriptions')
      .select('user_id')
      .eq('status', 'active');

    if (subError) {
      throw subError;
    }

    const activeUserIds = activeSubscriptions?.map(s => s.user_id) || [];

    if (activeUserIds.length === 0) {
      console.log('No active subscriptions found');
      return res.status(200).json({
        success: true,
        plateCount: 0,
        emailSent: false,
        recipientEmail: vaEmail,
        error: 'No active subscriptions',
      });
    }

    // Get all active monitored plates from users with active subscriptions
    const { data: plates, error: platesError } = await supabase
      .from('monitored_plates')
      .select('plate, state, user_id')
      .eq('status', 'active')
      .in('user_id', activeUserIds)
      .order('plate', { ascending: true });

    if (platesError) {
      throw platesError;
    }

    if (!plates || plates.length === 0) {
      console.log('No active plates to export');
      return res.status(200).json({
        success: true,
        plateCount: 0,
        emailSent: false,
        recipientEmail: vaEmail,
        error: 'No active plates to export',
      });
    }

    // Get user profiles to get first/last names
    const { data: profiles } = await supabase
      .from('autopilot_profiles')
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

      // Fall back to parsing full_name if first/last not set
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

    // Determine day of week for email subject
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const subject = `Autopilot Plate Check - ${dayOfWeek} - ${plates.length} plates`;

    // Generate email HTML
    const html = generateEmailHTML(plates.length, dayOfWeek);

    // Send email with CSV attachment
    const emailSent = await sendEmailWithAttachment(vaEmail, subject, html, csvContent, filename);

    // Log export job
    await supabase
      .from('plate_export_jobs')
      .insert({
        plate_count: plates.length,
        status: emailSent ? 'complete' : 'failed',
        va_email: vaEmail,
        email_sent_to_va: emailSent,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

    console.log(`✅ Plate export complete: ${plates.length} plates, email sent: ${emailSent}`);

    return res.status(200).json({
      success: true,
      plateCount: plates.length,
      emailSent,
      recipientEmail: vaEmail,
    });

  } catch (error: any) {
    console.error('Plate export error:', error);
    return res.status(500).json({
      success: false,
      plateCount: 0,
      emailSent: false,
      recipientEmail: null,
      error: sanitizeErrorMessage(error),
    });
  }
}
