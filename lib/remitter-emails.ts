import { supabaseAdmin } from './supabase';
import { Resend } from 'resend';

/**
 * Remitter Email System
 *
 * Sends daily/weekly emails to remitters with pending renewals
 * Includes confirmation links for easy status updates
 */

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface PendingRenewal {
  id: string;
  user_id: string;
  renewal_type: 'city_sticker' | 'license_plate';
  renewal_due_date: string;
  amount: number;
  metadata?: any;
  user_profiles: {
    email: string;
    first_name: string | null;
    last_name: string | null;
    license_plate: string | null;
    license_state: string | null;
    vin: string | null;
    home_address_full: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    has_permit_zone: boolean;
    phone_number: string | null;
  };
}

/**
 * Send daily remitter email with pending renewals
 */
export async function sendRemitterDailyEmail(
  remitterEmail: string = process.env.REMITTER_EMAIL || 'remitter@example.com'
): Promise<{
  success: boolean;
  renewalCount: number;
  error?: string;
}> {
  try {
    if (!resend) {
      return {
        success: false,
        renewalCount: 0,
        error: 'Resend not configured (missing RESEND_API_KEY)'
      };
    }

    // Get pending renewals (from renewal_charges table)
    const { data: renewals, error: fetchError } = await supabaseAdmin
      .from('renewal_charges')
      .select(`
        id,
        user_id,
        renewal_type,
        renewal_due_date,
        amount,
        created_at,
        metadata,
        user_profiles!inner (
          email,
          first_name,
          last_name,
          license_plate,
          license_state,
          vin,
          home_address_full,
          city,
          state,
          zip_code,
          has_permit_zone,
          phone_number
        )
      `)
      .eq('status', 'succeeded') // User paid us
      .in('charge_type', ['sticker_renewal', 'license_plate_renewal']) // Only renewals
      .or('metadata->>city_payment_status.eq.pending,metadata->>city_payment_status.is.null') // Not yet paid to city
      .gte('renewal_due_date', new Date().toISOString().split('T')[0]) // Only current/future
      .order('renewal_due_date', { ascending: true })
      .limit(100);

    if (fetchError) {
      console.error('Error fetching pending renewals:', fetchError);
      return {
        success: false,
        renewalCount: 0,
        error: fetchError.message
      };
    }

    if (!renewals || renewals.length === 0) {
      console.log('No pending renewals to send to remitter');
      return {
        success: true,
        renewalCount: 0
      };
    }

    // Generate email HTML
    const emailHtml = generateRemitterEmailHTML(renewals as any);
    const emailText = generateRemitterEmailText(renewals as any);

    // Send email
    const { error: sendError } = await resend.emails.send({
      from: process.env.RESEND_FROM || 'Autopilot America <alerts@autopilotamerica.com>',
      to: [remitterEmail],
      subject: `${renewals.length} Renewal${renewals.length !== 1 ? 's' : ''} Ready for Submission - ${new Date().toLocaleDateString()}`,
      html: emailHtml,
      text: emailText,
      reply_to: 'support@autopilotamerica.com'
    });

    if (sendError) {
      console.error('Error sending remitter email:', sendError);
      return {
        success: false,
        renewalCount: renewals.length,
        error: sendError.message
      };
    }

    console.log(`✅ Sent remitter email with ${renewals.length} pending renewals`);

    return {
      success: true,
      renewalCount: renewals.length
    };
  } catch (error: any) {
    console.error('Error in sendRemitterDailyEmail:', error);
    return {
      success: false,
      renewalCount: 0,
      error: error.message
    };
  }
}

/**
 * Generate HTML email for remitter
 */
function generateRemitterEmailHTML(renewals: PendingRenewal[]): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const cityStickers = renewals.filter((r) => r.renewal_type === 'city_sticker');
  const licensePlates = renewals.filter((r) => r.renewal_type === 'license_plate');

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pending Renewals - ${today}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">

  <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 24px;">🚗 Autopilot America</h1>
    <p style="margin: 8px 0 0; font-size: 16px;">Remitter Dashboard - ${today}</p>
  </div>

  <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb;">
    <h2 style="margin: 0 0 16px; color: #1f2937;">📋 Pending Renewals</h2>
    <p style="margin: 0 0 20px; font-size: 16px;">
      <strong>${renewals.length}</strong> renewal${renewals.length !== 1 ? 's' : ''} ready for submission to the city:
    </p>
    <ul style="margin: 0 0 20px; padding-left: 20px;">
      <li><strong>${cityStickers.length}</strong> City Sticker${cityStickers.length !== 1 ? 's' : ''}</li>
      <li><strong>${licensePlates.length}</strong> License Plate${licensePlates.length !== 1 ? 's' : ''}</li>
    </ul>
  </div>

  ${cityStickers.length > 0 ? `
  <div style="margin-top: 30px;">
    <h2 style="color: #1f2937; border-bottom: 2px solid #2563eb; padding-bottom: 8px;">
      City Sticker Renewals (${cityStickers.length})
    </h2>
    ${cityStickers.map((renewal, index) => generateRenewalHTML(renewal, index + 1, baseUrl)).join('\n')}
  </div>
  ` : ''}

  ${licensePlates.length > 0 ? `
  <div style="margin-top: 30px;">
    <h2 style="color: #1f2937; border-bottom: 2px solid #10b981; padding-bottom: 8px;">
      License Plate Renewals (${licensePlates.length})
    </h2>
    ${licensePlates.map((renewal, index) => generateRenewalHTML(renewal, index + 1, baseUrl)).join('\n')}
  </div>
  ` : ''}

  <div style="background: #eff6ff; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; margin-top: 30px;">
    <h3 style="margin: 0 0 12px; color: #1e40af;">📝 Instructions</h3>
    <ol style="margin: 0; padding-left: 20px; color: #1e40af;">
      <li>Submit each renewal to the city website</li>
      <li>Get confirmation number from the city</li>
      <li>Click "Mark as Submitted" button for each renewal (or use API)</li>
      <li>System will automatically update user's expiry date to next year</li>
    </ol>
  </div>

  <div style="background: #f9fafb; padding: 20px; margin-top: 30px; text-align: center; border-radius: 0 0 8px 8px;">
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      Questions? Contact <a href="mailto:support@autopilotamerica.com" style="color: #2563eb;">support@autopilotamerica.com</a>
    </p>
    <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">
      API Documentation: <a href="${baseUrl}/api/remitter/pending-renewals" style="color: #2563eb;">View API</a>
    </p>
  </div>

</body>
</html>
  `.trim();
}

/**
 * Generate HTML for a single renewal
 */
function generateRenewalHTML(renewal: PendingRenewal, index: number, baseUrl: string): string {
  const user = renewal.user_profiles;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
  const address = [user.home_address_full, user.city, user.state, user.zip_code]
    .filter(Boolean)
    .join(', ');

  // Generate confirmation link
  const confirmUrl = `${baseUrl}/api/remitter/confirm?id=${renewal.id}&type=${renewal.renewal_type}`;

  return `
  <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
      <h3 style="margin: 0; color: #1f2937; font-size: 18px;">
        #${index} - ${renewal.renewal_type === 'city_sticker' ? '🏙️ City Sticker' : '🚗 License Plate'}
      </h3>
      <span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 4px; font-size: 14px; font-weight: 600;">
        Due: ${new Date(renewal.renewal_due_date).toLocaleDateString()}
      </span>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280; width: 140px;">Name:</td>
        <td style="padding: 8px 0; color: #1f2937;">${fullName}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Email:</td>
        <td style="padding: 8px 0; color: #1f2937;">${user.email}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Phone:</td>
        <td style="padding: 8px 0; color: #1f2937;">${user.phone_number || 'N/A'}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">License Plate:</td>
        <td style="padding: 8px 0; color: #1f2937; font-family: monospace; font-size: 16px;">
          ${user.license_state || 'IL'} ${user.license_plate || 'N/A'}
        </td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">VIN:</td>
        <td style="padding: 8px 0; color: #1f2937; font-family: monospace;">
          ${user.vin || 'N/A'}
        </td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Address:</td>
        <td style="padding: 8px 0; color: #1f2937;">${address || 'N/A'}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Amount:</td>
        <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">
          $${(renewal.amount).toFixed(2)}
        </td>
      </tr>
      ${user.has_permit_zone ? `
      <tr>
        <td style="padding: 8px 0; font-weight: 600; color: #dc2626;">Permit Zone:</td>
        <td style="padding: 8px 0; color: #dc2626; font-weight: 600;">
          ⚠️ YES - Documents Required
        </td>
      </tr>
      ` : ''}
    </table>

    <div style="text-align: center; margin-top: 16px;">
      <a href="${confirmUrl}"
         style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 15px;">
        ✅ Mark as Submitted
      </a>
    </div>

    <p style="margin: 12px 0 0; text-align: center; font-size: 13px; color: #6b7280;">
      Renewal ID: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px;">${renewal.id}</code>
    </p>
  </div>
  `;
}

/**
 * Generate plain text email for remitter
 */
function generateRemitterEmailText(renewals: PendingRenewal[]): string {
  const today = new Date().toLocaleDateString();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

  let text = `
AUTOPILOT AMERICA - PENDING RENEWALS
${today}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUMMARY
Total Renewals: ${renewals.length}
City Stickers: ${renewals.filter((r) => r.renewal_type === 'city_sticker').length}
License Plates: ${renewals.filter((r) => r.renewal_type === 'license_plate').length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RENEWALS
`;

  renewals.forEach((renewal, index) => {
    const user = renewal.user_profiles;
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
    const address = [user.home_address_full, user.city, user.state, user.zip_code]
      .filter(Boolean)
      .join(', ');

    text += `
#${index + 1} - ${renewal.renewal_type === 'city_sticker' ? 'CITY STICKER' : 'LICENSE PLATE'}
Due Date: ${new Date(renewal.renewal_due_date).toLocaleDateString()}
Name: ${fullName}
Email: ${user.email}
Phone: ${user.phone_number || 'N/A'}
Plate: ${user.license_state || 'IL'} ${user.license_plate || 'N/A'}
VIN: ${user.vin || 'N/A'}
Address: ${address || 'N/A'}
Amount: $${(renewal.amount).toFixed(2)}
${user.has_permit_zone ? 'PERMIT ZONE: YES - Documents Required\n' : ''}
Renewal ID: ${renewal.id}

Confirmation Link:
${baseUrl}/api/remitter/confirm?id=${renewal.id}&type=${renewal.renewal_type}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  });

  text += `
INSTRUCTIONS
1. Submit each renewal to the city website
2. Get confirmation number from the city
3. Click "Mark as Submitted" link (or use API)
4. System will auto-update user's expiry date to next year

API: ${baseUrl}/api/remitter/pending-renewals

Questions? support@autopilotamerica.com
`;

  return text.trim();
}
