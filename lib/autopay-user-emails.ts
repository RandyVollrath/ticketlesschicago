/**
 * User-facing emails for Late Fee Protection. Both follow the visual style
 * of the renewal-charge confirmation/failure templates so the brand stays
 * consistent.
 */

const RESEND_FROM = 'Autopilot America <alerts@autopilotamerica.com>';
const SUPPORT_EMAIL = 'support@autopilotamerica.com';

async function sendResendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[autopay-user-emails] RESEND_API_KEY missing — skipping email');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend send failed: ${response.status} ${body}`.trim());
  }
}

function formatMoney(n: number | null | undefined): string {
  if (n == null) return 'unknown';
  return `$${n.toFixed(2)}`;
}

export async function sendAutopayPaidEmail(params: {
  to: string;
  firstName?: string | null;
  ticketNumber?: string | null;
  amountCharged: number;
  cityPaymentReference: string;
  isSimulated: boolean;
}) {
  const greeting = params.firstName ? `Hi ${params.firstName},` : 'Hi,';
  const ticketLine = params.ticketNumber ? `Ticket: <strong>${params.ticketNumber}</strong>` : '';
  const simBadge = params.isSimulated
    ? '<p style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px;color:#92400e;font-size:13px;margin:16px 0;"><strong>Test mode:</strong> no real money was moved. This is a simulated autopay confirmation.</p>'
    : '';
  const simTextBadge = params.isSimulated ? '\n[TEST MODE — no real money was moved]\n' : '';

  await sendResendEmail({
    to: params.to,
    subject: params.isSimulated
      ? '[Test mode] We paid your ticket for you'
      : 'We paid your ticket for you',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="color:#1a1a1a;">Late Fee Protection — payment complete</h2>
        ${simBadge}
        <p style="font-size:16px;line-height:1.6;">${greeting}</p>
        <p style="font-size:16px;line-height:1.6;">
          You opted in to Late Fee Protection on this ticket, and the contest came back as a loss (or a reduced amount). To make sure you avoid late fees, we paid the City of Chicago on your behalf.
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:24px 0;font-size:15px;">
          ${ticketLine ? `<p style="margin:0 0 8px 0;">${ticketLine}</p>` : ''}
          <p style="margin:0 0 8px 0;">Amount paid: <strong>${formatMoney(params.amountCharged)}</strong></p>
          <p style="margin:0;">City confirmation: <code>${params.cityPaymentReference}</code></p>
        </div>
        <p style="font-size:14px;line-height:1.6;color:#374151;">
          You don't need to do anything else. The card you have on file with us was charged.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;" />
        <p style="color:#9ca3af;font-size:13px;">Questions? Email <a href="mailto:${SUPPORT_EMAIL}" style="color:#0052cc;">${SUPPORT_EMAIL}</a></p>
      </div>
    `,
    text: [
      `Late Fee Protection — payment complete${simTextBadge}`,
      '',
      greeting,
      '',
      `You opted in to Late Fee Protection on this ticket. The contest came back as a loss/reduction, so to keep you out of late fees we paid the City of Chicago on your behalf.`,
      '',
      params.ticketNumber ? `Ticket: ${params.ticketNumber}` : '',
      `Amount paid: ${formatMoney(params.amountCharged)}`,
      `City confirmation: ${params.cityPaymentReference}`,
      '',
      `Questions? Email ${SUPPORT_EMAIL}`,
    ].filter(Boolean).join('\n'),
  });
}

export async function sendAutopayFailedEmail(params: {
  to: string;
  firstName?: string | null;
  ticketNumber?: string | null;
  finalAmount: number | null;
  errorMessage: string;
}) {
  const greeting = params.firstName ? `Hi ${params.firstName},` : 'Hi,';
  const ticketLine = params.ticketNumber ? `<p style="margin:0 0 8px 0;">Ticket: <strong>${params.ticketNumber}</strong></p>` : '';

  await sendResendEmail({
    to: params.to,
    subject: 'Autopay failed — please pay your ticket manually',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="color:#dc2626;">Autopay attempt failed</h2>
        <p style="font-size:16px;line-height:1.6;">${greeting}</p>
        <p style="font-size:16px;line-height:1.6;">
          We tried to pay your ticket for you under Late Fee Protection, but the payment did not go through. To avoid late fees, please pay the ticket directly with the City of Chicago before the deadline.
        </p>
        <div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;padding:20px;margin:24px 0;font-size:15px;color:#991b1b;">
          ${ticketLine}
          <p style="margin:0 0 8px 0;">Amount owed: <strong>${formatMoney(params.finalAmount)}</strong></p>
          <p style="margin:0;font-size:13px;">Reason: ${params.errorMessage}</p>
        </div>
        <p style="font-size:14px;line-height:1.6;color:#374151;">Common causes: card expired, insufficient funds, bank flagged the charge.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;" />
        <p style="color:#9ca3af;font-size:13px;">Questions? Email <a href="mailto:${SUPPORT_EMAIL}" style="color:#0052cc;">${SUPPORT_EMAIL}</a></p>
      </div>
    `,
    text: [
      'Autopay failed — please pay your ticket manually',
      '',
      greeting,
      '',
      `We tried to pay your ticket for you under Late Fee Protection, but the payment did not go through. To avoid late fees, please pay the ticket directly with the City of Chicago before the deadline.`,
      '',
      params.ticketNumber ? `Ticket: ${params.ticketNumber}` : '',
      `Amount owed: ${formatMoney(params.finalAmount)}`,
      `Reason: ${params.errorMessage}`,
      '',
      `Questions? Email ${SUPPORT_EMAIL}`,
    ].filter(Boolean).join('\n'),
  });
}
