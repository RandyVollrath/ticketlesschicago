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

export const CHICAGO_FOIA_EMAIL = 'DOFfoia@cityofchicago.org';

/**
 * Generate a FOIA request for complete ticket history on a license plate.
 */
export function generateTicketHistoryFoiaEmail(params: {
  name: string;
  email: string;
  licensePlate: string;
  licenseState: string;
}): { subject: string; body: string } {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const subject = `FOIA Request - Complete Ticket History - Plate ${params.licenseState} ${params.licensePlate}`;

  const body = `Department of Finance
FOIA Officer
121 North LaSalle Street, 7th Floor
Chicago, Illinois 60602

Date: ${today}

Re: Freedom of Information Act Request
    Complete Parking and Traffic Citation History
    License Plate: ${params.licenseState} ${params.licensePlate}

Dear FOIA Officer:

Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I am requesting copies of the following records:

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

   3. Any FOIA requests previously submitted regarding this plate number.

I am the registered owner of the vehicle bearing this plate and am requesting these records for my personal use.

Please provide these records in electronic format via email to ${params.email}. If any records are unavailable, I request a written explanation of why they cannot be produced, as required by 5 ILCS 140/3(g).

Under the Act, you are required to respond to this request within five (5) business days. If you need additional time, please provide written notice as required by 5 ILCS 140/3(e).

I am willing to pay reasonable copying fees up to $25.00. If fees will exceed this amount, please notify me before processing.

Thank you for your prompt attention to this matter.

Sincerely,

${params.name}
${params.email}`;

  return { subject, body };
}

/**
 * Send the FOIA history request email via Resend.
 */
export async function sendTicketHistoryFoiaEmail(params: {
  name: string;
  email: string;
  licensePlate: string;
  licenseState: string;
}): Promise<{ success: boolean; emailId?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const { subject, body } = generateTicketHistoryFoiaEmail(params);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${params.name} via Autopilot <foia@autopilotamerica.com>`,
        to: [CHICAGO_FOIA_EMAIL],
        subject,
        text: body,
        reply_to: params.email,
        headers: {
          'X-Entity-Ref-ID': `foia-history-${params.licenseState}-${params.licensePlate}-${Date.now()}`,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Resend API error: ${errorText}` };
    }

    const data = await response.json();
    return { success: true, emailId: data.id };
  } catch (err: any) {
    return { success: false, error: `Send exception: ${err.message}` };
  }
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
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${params.name},</p>

        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          We just submitted an official <strong>Freedom of Information Act (FOIA) request</strong> to the
          Chicago Department of Finance requesting the complete ticket history for plate
          <strong>${params.licenseState} ${params.licensePlate}</strong>.
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
            on your dashboard at <a href="https://autopilotamerica.com/settings" style="color: #2563EB;">autopilotamerica.com/settings</a>.
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

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); color: white; padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Your Ticket History Is Ready</h1>
        <p style="margin: 8px 0 0; opacity: 0.8; font-size: 15px;">FOIA results for plate ${params.licenseState} ${params.licensePlate}</p>
      </div>
      <div style="padding: 32px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${params.name},</p>

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

        <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <h3 style="margin: 0 0 8px; color: #166534; font-size: 16px;">Stop the cycle</h3>
          <p style="margin: 0 0 12px; color: #15803D; font-size: 14px; line-height: 1.6;">
            ${params.ticketCount > 0
              ? `You've already paid $${params.totalFines.toLocaleString()} in tickets. Our Autopilot system catches new tickets and contests them automatically — $49/year could save you hundreds.`
              : `Even with a clean record, one surprise ticket can cost you $100+. Get protected for $49/year.`
            }
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
        subject: `Your ticket history: ${params.ticketCount} ticket${params.ticketCount !== 1 ? 's' : ''} found for plate ${params.licenseState} ${params.licensePlate}`,
        html,
      }),
    });
  } catch (err: any) {
    console.error(`Failed to send FOIA history results email: ${err.message}`);
  }
}
