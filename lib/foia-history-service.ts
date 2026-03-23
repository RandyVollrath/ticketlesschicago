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

import { quickEmail, greeting as greet, p, callout, section, button, divider, bulletList, esc, statRow, stat } from './email-template';

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

  const safeName = esc(params.name);
  const safePlate = esc(params.licensePlate);
  const safeState = esc(params.licenseState);

  const html = quickEmail({
    preheader: `Your FOIA request for plate ${params.licenseState} ${params.licensePlate} has been submitted`,
    headerTitle: 'Your FOIA Request Has Been Submitted',
    headerSubtitle: "We're pulling your complete ticket history from the City of Chicago",
    body: [
      greet(params.name || undefined),
      p(`We just submitted an official <strong>Freedom of Information Act (FOIA) request</strong> to the Chicago Department of Finance requesting the complete ticket history for plate <strong>${safeState} ${safePlate}</strong>.`),
      section('What We Requested', bulletList([
        'Every parking ticket and citation ever issued to your plate',
        'Violation types, dates, locations, and fine amounts',
        'Payment status and hearing outcomes',
        'Any contest or dismissal records',
      ]), { bg: '#F0F9FF', borderColor: '#BAE6FD' }),
      callout('warning', 'What Happens Next',
        `The city is required by law to respond within <strong>5 business days</strong>. Once we receive your data, we'll email you a full report and make it available on your dashboard at <a href="https://autopilotamerica.com/my-tickets" style="color: #2563EB;">autopilotamerica.com/my-tickets</a>.`),
      section('Protect Yourself Going Forward',
        p('Chicago issues nearly 3 million parking tickets every year. Autopilot monitors your plate daily, catches new tickets the moment they\'re issued, and automatically contests them for you.'),
        { bg: '#F0FDF4', borderColor: '#86EFAC' }),
      button('Get Protected — $49/year', 'https://autopilotamerica.com/get-started', { color: '#10B981' }),
    ].join(''),
  });

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
  const safePlate = esc(params.licensePlate);
  const safeState = esc(params.licenseState);

  const html = quickEmail({
    preheader: `Your FOIA results: ${params.ticketCount} ticket${params.ticketCount !== 1 ? 's' : ''} found for plate ${params.licenseState} ${params.licensePlate}`,
    headerTitle: 'Your Ticket History Is Ready',
    headerSubtitle: `FOIA results for plate ${safeState} ${safePlate}`,
    body: [
      greet(params.name || undefined),
      p('The City of Chicago responded to your FOIA request. Here\'s what we found:'),
      statRow(
        stat(String(params.ticketCount), 'Total Tickets', { bg: '#FEF2F2', color: '#DC2626' }) +
        stat(`$${params.totalFines.toLocaleString()}`, 'Total Fines', { bg: '#FFF7ED', color: '#EA580C' })
      ),
      button('View Full Report', params.resultsUrl),
      params.ticketCount > 0
        ? callout('danger', `You could have saved up to $${potentialSavings.toLocaleString()}`,
            `City of Chicago data shows that <strong>68.5% of contested parking tickets are dismissed</strong>. If every one of your ${params.ticketCount} ticket${params.ticketCount !== 1 ? 's' : ''} had been automatically contested, you could have saved up to <strong>$${potentialSavings.toLocaleString()}</strong> in fines.`)
        : '',
      section('Never stress about a ticket again',
        p(params.ticketCount > 0
          ? 'Chicago issues nearly 3 million parking tickets every year — and paying full price for every one isn\'t inevitable. Autopilot monitors your plate daily, catches new tickets the moment they\'re issued, and automatically contests them for you.'
          : 'Chicago issues nearly 3 million parking tickets every year. When your first one lands, Autopilot catches it immediately and contests it for you automatically.'
        ) + bulletList([
          '<strong>Daily plate monitoring</strong> — We check for new tickets so you don\'t have to',
          '<strong>Automatic contest letters</strong> — Custom defense letters mailed before the deadline',
          '<strong>Real-time parking alerts</strong> — Street cleaning, tow zones, and permit warnings on your phone',
        ]),
        { bg: '#F0FDF4', borderColor: '#86EFAC' }),
      button('Get Protected — $49/year', 'https://autopilotamerica.com/get-started', { color: '#10B981' }),
      p(params.ticketCount > 0
        ? `That's less than the cost of a single $${avgPerTicket} ticket.`
        : 'Less than the cost of a single parking ticket.',
        { size: '13px', color: '#6B7280', center: true }),
    ].join(''),
  });

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
