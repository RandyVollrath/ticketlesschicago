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
    preheader: `We just filed a FOIA on plate ${params.licenseState} ${params.licensePlate}. The city has 5 days to hand over every ticket on record.`,
    headerTitle: 'We just pulled the trigger on your FOIA.',
    headerSubtitle: `Plate ${safeState} ${safePlate} — full ticket history requested`,
    body: [
      greet(params.name || undefined),
      p(`We just filed an official <strong>Freedom of Information Act request</strong> with the Chicago Department of Finance demanding every parking ticket, citation, and violation ever written against plate <strong>${safeState} ${safePlate}</strong>.`),
      p("This isn't a polite ask. It's a legal demand. Under Illinois law (5 ILCS 140), the city <strong>must</strong> respond within 5 business days — or explain in writing why they can't."),
      section('What We Demanded', bulletList([
        'Every parking ticket and citation ever issued to your plate',
        'Violation types, dates, locations, and fine amounts',
        'Current status — paid, unpaid, contested, dismissed',
        'Hearing outcomes and contest records',
      ]), { bg: '#F0F9FF', borderColor: '#BAE6FD' }),
      callout('warning', 'The clock is ticking',
        `The city has <strong>5 business days</strong> to respond. When they do, we'll email you the full breakdown — every ticket, every fine, every outcome — and post it to your dashboard at <a href="https://autopilotamerica.com/my-tickets" style="color: #2563EB;">autopilotamerica.com/my-tickets</a>.`),
      callout('danger', 'Here\'s what most people find out',
        'The average Chicago driver has tickets they forgot about, tickets they never knew existed, and fines that doubled while sitting in collections. <strong>59% of mail-in contested parking tickets in Chicago get dismissed</strong> (FOIA, 2023–2025). Many of yours could have been fought — and won.'),
      button('Get Protected — $99/year', 'https://autopilotamerica.com/get-started', { color: '#10B981' }),
      p("One dismissed ticket pays for the entire year.", { size: '13px', color: '#6B7280', center: true }),
    ].join(''),
  });

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [params.email],
      subject: `FOIA filed on plate ${params.licenseState} ${params.licensePlate} — the city has 5 days to respond`,
      html,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend ${resp.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Send the user their FOIA results when the city responds.
 *
 * Three variants depending on how the City of Chicago answered:
 *   has_records      — city sent the ticket list (most Chicago plates)
 *   no_records_found — city searched and found nothing on file
 *   withheld_records — city refused to release records (most often: out-of-state plate
 *                      where DOF cites a privacy/exemption to deny non-Illinois requesters)
 *
 * Picked by `cityResponseType`. If omitted, falls back to has_records vs no_records_found
 * based on ticketCount, which preserves prior behavior.
 */
export type CityResponseType = 'has_records' | 'no_records_found' | 'withheld_records';

export async function sendFoiaHistoryResultsEmail(params: {
  email: string;
  name: string;
  licensePlate: string;
  licenseState: string;
  ticketCount: number;
  totalFines: number;
  resultsUrl: string;
  cityResponseType?: CityResponseType;
  withheldExplanation?: string; // optional human-readable reason from the AI summary
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const responseType: CityResponseType =
    params.cityResponseType ??
    (params.ticketCount > 0 ? 'has_records' : 'no_records_found');

  const potentialSavings = Math.round(params.totalFines * 0.59);
  const avgPerTicket = params.ticketCount > 0 ? Math.round(params.totalFines / params.ticketCount) : 75;
  const safePlate = esc(params.licensePlate);
  const safeState = esc(params.licenseState);
  const isOutOfState = (params.licenseState || 'IL').toUpperCase() !== 'IL';

  // ── Variant: city withheld records (most often out-of-state plate) ──
  if (responseType === 'withheld_records') {
    const html = quickEmail({
      preheader: `Chicago DOF received your FOIA but declined to release records for plate ${params.licenseState} ${params.licensePlate}.`,
      headerTitle: 'The City declined to release your records.',
      headerSubtitle: `FOIA response for plate ${safeState} ${safePlate}`,
      body: [
        greet(params.name || undefined),
        p(`Chicago's Department of Finance responded to our FOIA request for plate <strong>${safeState} ${safePlate}</strong>, but they declined to hand over the records.`),
        params.withheldExplanation
          ? callout('warning', 'What the city said', esc(params.withheldExplanation))
          : '',
        isOutOfState
          ? p(`Here's the most likely reason — and the City rarely explains this clearly: <strong>Chicago DOF treats parking-citation records for out-of-state plates as protected under personal-information exemptions.</strong> For Illinois plates they typically release the full history. For plates registered in another state (yours: ${safeState}), they often refuse to release them unless the requester is also the registered owner with proof of identity.`)
          : p("This is unusual for Illinois plates. The City has limited statutory grounds to withhold these records under 5 ILCS 140 — and they didn't cite a specific exemption that survives scrutiny."),
        callout('info', "Here's what we're doing next",
          `We're filing a <strong>Request for Review</strong> with the Illinois Attorney General's Public Access Counselor under 5 ILCS 140/9.5, challenging the City's denial. The PAC can order the City to release records when an exemption is misapplied. We'll let you know what they decide — these reviews typically take a few weeks.`),
        isOutOfState
          ? p(`In parallel, if you want your records faster, you can re-file the FOIA yourself as the registered owner from your ${safeState} address with a copy of your ${safeState} title or registration. DOF usually releases records when the requester is also the owner of the vehicle.`)
          : p('In the meantime, if you remember specific tickets you want details on, hit reply with the ticket numbers — we may be able to pull individual records through a different request path.'),
        // Soft mention of Autopilot — since we couldn't deliver records this time, keep it light.
        p(`Autopilot America monitors Chicago parking tickets and automatically contests them by mail. ${isOutOfState ? "It's built around Illinois plates, but " : ''}if you park in Chicago regularly with a plate registered there, it can stop most of your ticket cost before it happens.`, { size: '14px', color: '#475569' }),
        button('Learn how Autopilot works', 'https://autopilotamerica.com'),
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
          subject: `Chicago declined to release records for plate ${params.licenseState} ${params.licensePlate} — here's why`,
          html,
        }),
      });
    } catch (err: any) {
      console.error(`Failed to send FOIA history results email: ${err.message}`);
    }
    return;
  }

  // ── Variants: has_records or no_records_found ──
  const html = quickEmail({
    preheader: params.ticketCount > 0
      ? `${params.ticketCount} tickets. $${params.totalFines.toLocaleString()} in fines. Up to $${potentialSavings.toLocaleString()} you could have saved.`
      : `Clean record for plate ${params.licenseState} ${params.licensePlate}. Let's keep it that way.`,
    headerTitle: params.ticketCount > 0
      ? `$${params.totalFines.toLocaleString()} in tickets. Here's the damage.`
      : 'Clean record. Let\'s keep it that way.',
    headerSubtitle: `FOIA results for plate ${safeState} ${safePlate}`,
    body: [
      greet(params.name || undefined),
      p(params.ticketCount > 0
        ? 'The city handed over your records. Let\'s look at what they\'ve been charging you:'
        : 'Good news — the city came back with a clean slate. No tickets on record for your plate.'),
      statRow(
        stat(String(params.ticketCount), 'Total Tickets', { bg: '#FEF2F2', color: '#DC2626' }) +
        stat(`$${params.totalFines.toLocaleString()}`, 'Total Fines', { bg: '#FFF7ED', color: '#EA580C' })
      ),
      button('View Full Report', params.resultsUrl),
      params.ticketCount > 0
        ? callout('danger', `You left up to $${potentialSavings.toLocaleString()} on the table`,
            `<strong>59% of mail-in contested parking tickets in Chicago get dismissed</strong> (FOIA, 2023–2025). That's not a guess — it's city data. If every one of your ${params.ticketCount} ticket${params.ticketCount !== 1 ? 's' : ''} had been automatically mail-contested, the historical dismissal rate suggests up to <strong>$${potentialSavings.toLocaleString()}</strong> could have stayed in your pocket instead of the city's.`)
        : '',
      params.ticketCount > 0
        ? p("Most people don't contest because it's a hassle. You have to figure out the defense, write the letter, mail it before the deadline, and hope you got the legal language right. <strong>Nobody has time for that.</strong> So you pay. And the city counts on it.")
        : p("But here's the reality: Chicago writes <strong>4.5 million tickets a year</strong>. It's not a matter of if — it's when. And when it happens, most people just pay because contesting feels like too much work."),
      callout('success', params.ticketCount > 0 ? 'Never pay full price again' : 'Be ready when it happens',
        "Autopilot monitors your plate twice a week. New ticket? We generate a custom contest letter with the specific legal defense for that violation and mail it before the deadline. <strong>59% of mail-contested tickets get dismissed.</strong> You don't do anything."),
      section('What $99/year gets you', bulletList([
        '<strong>Twice-weekly plate monitoring</strong> — we catch tickets within days, not months',
        '<strong>Automatic contest letters</strong> — custom legal defense for each violation, mailed for you',
        '<strong>Street cleaning, snow ban, and sticker alerts</strong> — stop tickets before they happen',
        '<strong>First Dismissal Guarantee</strong> — if your first contest isn\'t dismissed, full refund',
      ])),
      button('Start Autopilot Protection — $99/year', 'https://autopilotamerica.com/get-started', { color: '#10B981' }),
      p(params.ticketCount > 0
        ? `That's less than a single $${avgPerTicket} ticket. One dismissal pays for itself.`
        : 'Less than the cost of a single parking ticket. One dismissal pays for itself.',
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
        subject: params.ticketCount > 0
          ? `${params.ticketCount} tickets. $${params.totalFines.toLocaleString()} in fines. Here's your FOIA report.`
          : `Clean record for plate ${params.licenseState} ${params.licensePlate} — here's your FOIA report`,
        html,
      }),
    });
  } catch (err: any) {
    console.error(`Failed to send FOIA history results email: ${err.message}`);
  }
}

/**
 * Classify the city's FOIA response by inspecting the AI summary.
 * Used by processHistoryFoiaResponse to pick the right email variant.
 */
export function classifyCityResponse(
  ticketCount: number,
  aiSummary: string | null | undefined,
): CityResponseType {
  if (ticketCount > 0) return 'has_records';
  const s = (aiSummary || '').toLowerCase();
  const withheldKeywords = [
    'withheld', 'withhold',
    'exemp', // exemption, exempt
    'denied', 'denial',
    'cannot release', 'will not release', 'refuse',
    'redacted',
    'privacy', 'personal information',
    '7(1)(b)', '7(1)(c)', // common Illinois FOIA private-info exemptions
    'out-of-state', 'out of state',
  ];
  if (withheldKeywords.some(k => s.includes(k))) return 'withheld_records';
  return 'no_records_found';
}
