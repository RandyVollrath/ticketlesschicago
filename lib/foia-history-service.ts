/**
 * FOIA Ticket History Service
 *
 * Generates and sends FOIA requests to the Chicago Department of Finance
 * asking for a complete history of all tickets written for a given license plate.
 *
 * This is different from the evidence FOIA in foia-request-service.ts, which requests
 * enforcement records for a specific ticket. This requests the full plate history.
 *
 * Recipient: DOFfoia@cityofchicago.org
 * Legal basis: Illinois FOIA (5 ILCS 140)
 */

import { nanoid } from 'nanoid';

export const CHICAGO_FOIA_EMAIL = 'DOFfoia@cityofchicago.org';

/**
 * Generate a unique reference ID for a history FOIA request.
 * Prefix APH = Autopilot History. Included in the email subject for
 * reliable response matching when the city replies.
 */
export function generateHistoryReferenceId(): string {
  return `APH-${nanoid(12)}`;
}

/**
 * Generate a FOIA request for complete ticket history on a license plate.
 * The email is sent by Autopilot America on behalf of the vehicle owner,
 * with a signed authorization attached as HTML.
 */
export function generateTicketHistoryFoiaEmail(params: {
  name: string;
  email: string;
  licensePlate: string;
  licenseState: string;
  signatureName?: string;
  signedAt?: string;
  referenceId?: string;
}): { subject: string; body: string } {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const refSuffix = params.referenceId ? ` [Ref: ${params.referenceId}]` : '';
  const subject = `FOIA Request - Complete Ticket History - Plate ${params.licenseState} ${params.licensePlate}${refSuffix}`;

  const body = `Department of Finance
FOIA Officer
121 North LaSalle Street, 7th Floor
Chicago, Illinois 60602

Date: ${today}

Re: Freedom of Information Act Request
    Complete Parking and Traffic Citation History
    License Plate: ${params.licenseState} ${params.licensePlate}
    Requestor: ${params.name} (${params.email})

Dear FOIA Officer:

Scarlet Carson, Inc (d/b/a Autopilot America) is submitting this request on behalf of ${params.name}, the registered owner of the vehicle bearing license plate ${params.licenseState} ${params.licensePlate}. A signed authorization from ${params.name} is attached to this email.

Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), we are requesting copies of the following records:

   1. A complete list of all parking tickets, traffic citations, and administrative violations issued to vehicles bearing license plate ${params.licenseState} ${params.licensePlate}, including but not limited to:
      - Ticket/citation number
      - Date of violation
      - Violation type and description
      - Violation code
      - Location of violation
      - Fine amount
      - Current status (paid, unpaid, contested, dismissed, etc.)
      - Any hearing or contest outcomes and dispositions

   2. Any administrative hearing records associated with the above citations, including hearing dates, hearing officer names, and dispositions.

${params.signatureName ? `The vehicle owner electronically signed the attached authorization on ${params.signedAt || today}.` : ''}

Please provide these records in electronic format via email to ${params.email} (the vehicle owner) and to foia@autopilotamerica.com.

If any records are unavailable, we request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).

Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).

Thank you for your prompt attention to this matter.

Sincerely,

Scarlet Carson, Inc
d/b/a Autopilot America
On behalf of ${params.name}
foia@autopilotamerica.com`;

  return { subject, body };
}

/**
 * Send the FOIA history request email via Resend, with signed authorization attached.
 */
export async function sendTicketHistoryFoiaEmail(params: {
  name: string;
  email: string;
  licensePlate: string;
  licenseState: string;
  signatureName?: string;
  signedAt?: string;
  authorizationHtml?: string;
  authorizationPdf?: Buffer;
  referenceId?: string;
}): Promise<{ success: boolean; emailId?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const { subject, body } = generateTicketHistoryFoiaEmail(params);

  // Build attachments array — include signed authorization if available (PDF preferred, HTML fallback)
  const attachments: Array<{ filename: string; content: string }> = [];
  if (params.authorizationPdf) {
    attachments.push({
      filename: `FOIA-Authorization-${params.licenseState}-${params.licensePlate}.pdf`,
      content: params.authorizationPdf.toString('base64'),
    });
  } else if (params.authorizationHtml) {
    const base64 = Buffer.from(params.authorizationHtml, 'utf-8').toString('base64');
    attachments.push({
      filename: `FOIA-Authorization-${params.licenseState}-${params.licensePlate}.html`,
      content: base64,
    });
  }

  try {
    const emailPayload: any = {
      from: `Autopilot America FOIA <foia@autopilotamerica.com>`,
      to: [CHICAGO_FOIA_EMAIL],
      subject,
      text: body,
      reply_to: ['foia@autopilotamerica.com', params.email],
      headers: {
        'X-Entity-Ref-ID': params.referenceId || `foia-history-${params.licenseState}-${params.licensePlate}-${Date.now()}`,
      },
    };
    if (attachments.length > 0) {
      emailPayload.attachments = attachments;
    }

    // 30-second timeout prevents a Resend hang from blocking the entire cron run
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Resend API error: ${errorText}` };
    }

    const data = await response.json();
    return { success: true, emailId: data.id };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'Resend API timeout (30s)' : err.message;
    return { success: false, error: `Send exception: ${msg}` };
  }
}

// Simple HTML escape for email templates — prevents XSS from user-supplied values
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Send the user a confirmation email that their FOIA request was submitted.
 */
export async function sendFoiaHistoryConfirmationEmail(params: {
  email: string;
  name: string;
  licensePlate: string;
  licenseState: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); color: white; padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Your FOIA Request Has Been Submitted</h1>
        <p style="margin: 8px 0 0; opacity: 0.8; font-size: 15px;">We're pulling your complete ticket history from the City of Chicago</p>
      </div>
      <div style="padding: 32px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${esc(params.name)},</p>

        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          We just submitted an official <strong>Freedom of Information Act (FOIA) request</strong> to the
          Chicago Department of Finance requesting the complete ticket history for plate
          <strong>${esc(params.licenseState)} ${esc(params.licensePlate)}</strong>.
        </p>

        <div style="background: #F0F9FF; border: 1px solid #BAE6FD; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <h3 style="margin: 0 0 12px; color: #0369A1; font-size: 16px;">What We Requested</h3>
          <ul style="margin: 0; padding-left: 20px; color: #0C4A6E; font-size: 14px; line-height: 1.8;">
            <li>Every parking ticket and citation ever issued to your plate</li>
            <li>Violation types, dates, locations, and fine amounts</li>
            <li>Payment status and hearing outcomes</li>
            <li>Any contest or dismissal records</li>
          </ul>
        </div>

        <div style="background: #FFF7ED; border: 1px solid #FED7AA; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <h3 style="margin: 0 0 8px; color: #9A3412; font-size: 16px;">What Happens Next</h3>
          <p style="margin: 0; color: #7C2D12; font-size: 14px; line-height: 1.6;">
            The city is required by law to respond within <strong>5 business days</strong>.
            Once we receive your data, we'll email you a full report and make it available
            on your dashboard at <a href="https://autopilotamerica.com/my-tickets" style="color: #2563EB;">autopilotamerica.com/my-tickets</a>.
          </p>
        </div>

        <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <h3 style="margin: 0 0 8px; color: #166534; font-size: 16px;">Protect Yourself Going Forward</h3>
          <p style="margin: 0 0 12px; color: #15803D; font-size: 14px; line-height: 1.6;">
            Chicago drivers get an average of 3+ tickets per year. Our Autopilot system automatically
            detects new tickets and contests them for you.
          </p>
          <a href="https://autopilotamerica.com/get-started"
             style="display: inline-block; background: #10B981; color: white; padding: 10px 24px;
                    border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Get Protected - $49/year
          </a>
        </div>

        <p style="color: #6b7280; font-size: 12px; margin-top: 32px; text-align: center;">
          Autopilot America &mdash; Fighting Chicago parking tickets since 2025
        </p>
      </div>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [params.email],
        subject: `Your ticket history request is in - we'll have results in 5 business days`,
        html,
      }),
    });
  } catch (err: any) {
    console.error(`Failed to send FOIA history confirmation email: ${err.message}`);
  }
}

/**
 * Send the user their FOIA results when the city responds.
 * This is called when an admin manually enters the results.
 */
export async function sendFoiaHistoryResultsEmail(params: {
  email: string;
  name: string;
  licensePlate: string;
  licenseState: string;
  ticketCount: number;
  totalFines: number;
  resultsUrl: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const potentialSavings = Math.round(params.totalFines * 0.685);
  const avgPerTicket = params.ticketCount > 0 ? Math.round(params.totalFines / params.ticketCount) : 75;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); color: white; padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Your Ticket History Is Ready</h1>
        <p style="margin: 8px 0 0; opacity: 0.8; font-size: 15px;">FOIA results for plate ${esc(params.licenseState)} ${esc(params.licensePlate)}</p>
      </div>
      <div style="padding: 32px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${esc(params.name)},</p>

        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          The City of Chicago responded to your FOIA request. Here's what we found:
        </p>

        <div style="display: flex; gap: 16px; margin: 24px 0;">
          <div style="flex: 1; background: #FEF2F2; border: 1px solid #FECACA; padding: 20px; border-radius: 8px; text-align: center;">
            <div style="font-size: 36px; font-weight: 800; color: #DC2626;">${params.ticketCount}</div>
            <div style="font-size: 13px; color: #991B1B; margin-top: 4px;">Total Tickets</div>
          </div>
          <div style="flex: 1; background: #FFF7ED; border: 1px solid #FED7AA; padding: 20px; border-radius: 8px; text-align: center;">
            <div style="font-size: 36px; font-weight: 800; color: #EA580C;">$${params.totalFines.toLocaleString()}</div>
            <div style="font-size: 13px; color: #9A3412; margin-top: 4px;">Total Fines</div>
          </div>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${params.resultsUrl}"
             style="display: inline-block; background: #2563EB; color: white; padding: 14px 32px;
                    border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
            View Full Report
          </a>
        </div>

        ${params.ticketCount > 0 ? `
        <div style="background: #FEF2F2; border: 1px solid #FECACA; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <h3 style="margin: 0 0 8px; color: #991B1B; font-size: 16px;">You could have saved up to $${potentialSavings.toLocaleString()}</h3>
          <p style="margin: 0; color: #7F1D1D; font-size: 14px; line-height: 1.6;">
            City of Chicago data shows that <strong>68.5% of contested parking tickets are dismissed</strong>.
            If every one of your ${params.ticketCount} ticket${params.ticketCount !== 1 ? 's' : ''} had been automatically
            contested, you could have saved up to <strong>$${potentialSavings.toLocaleString()}</strong> in fines.
          </p>
        </div>
        ` : ''}

        <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <h3 style="margin: 0 0 12px; color: #166534; font-size: 16px;">Never stress about a ticket again</h3>
          <p style="margin: 0 0 16px; color: #15803D; font-size: 14px; line-height: 1.6;">
            ${params.ticketCount > 0
              ? `Tickets are unavoidable in Chicago &mdash; the average driver gets 3+ per year. But paying full price for every one isn't. Autopilot monitors your plate daily, catches new tickets the moment they're issued, and automatically contests them for you.`
              : `Even with a clean record, Chicago drivers average 3+ tickets per year. When that first one lands, Autopilot catches it immediately and contests it for you automatically.`
            }
          </p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #BBF7D0; color: #166534; font-size: 13px;">
                <strong style="color: #15803D;">Daily plate monitoring</strong><br>
                <span style="color: #4ADE80;">We check for new tickets so you don't have to</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #BBF7D0; color: #166534; font-size: 13px;">
                <strong style="color: #15803D;">Automatic contest letters</strong><br>
                <span style="color: #4ADE80;">Custom defense letters mailed before the deadline</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #166534; font-size: 13px;">
                <strong style="color: #15803D;">Real-time parking alerts</strong><br>
                <span style="color: #4ADE80;">Street cleaning, tow zones, and permit warnings on your phone</span>
              </td>
            </tr>
          </table>
          <div style="text-align: center;">
            <a href="https://autopilotamerica.com/get-started"
               style="display: inline-block; background: #10B981; color: white; padding: 12px 28px;
                      border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
              Get Protected &mdash; $49/year
            </a>
            <p style="margin: 8px 0 0; color: #6EE7B7; font-size: 12px;">
              ${params.ticketCount > 0
                ? `That's less than the cost of a single $${avgPerTicket} ticket.`
                : `Less than the cost of a single parking ticket.`
              }
            </p>
          </div>
        </div>

        <p style="color: #6b7280; font-size: 12px; margin-top: 32px; text-align: center;">
          Autopilot America &mdash; Fighting Chicago parking tickets since 2025
        </p>
      </div>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [params.email],
        subject: `Your ticket history: ${params.ticketCount} ticket${params.ticketCount !== 1 ? 's' : ''} found for plate ${params.licenseState} ${params.licensePlate}`,
        html,
      }),
    });
  } catch (err: any) {
    console.error(`Failed to send FOIA history results email: ${err.message}`);
  }
}
