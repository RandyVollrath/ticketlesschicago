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

/**
 * Pre-charge email — fires when a contest letter flips to lost/reduced
 * and the user has Late Fee Protection on. We send this 21 days BEFORE
 * the actual Stripe charge so the user has the full city appeal window
 * (Chicago's pay-or-contest deadline is 25 days after liability) plus a
 * 4-day buffer to file an appeal or opt out by toggling Late Fee
 * Protection off.
 *
 * The 21-day grace is enforced in the autopilot-autopay-executor cron
 * via the autopay_pre_charge_notified_at column.
 */
export async function sendAutopayPreChargeEmail(params: {
  to: string;
  firstName?: string | null;
  ticketNumber?: string | null;
  finalAmount: number;
  scheduledChargeAt: Date;     // 21 days after this email
  cancelUrl: string;           // link to /account/autopay
}) {
  const fname = params.firstName ? params.firstName.split(' ')[0] : 'there';
  const ticketLabel = params.ticketNumber ? `ticket #${params.ticketNumber}` : 'your ticket';
  const amount = formatMoney(params.finalAmount);
  const chargeDate = params.scheduledChargeAt.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h1 style="font-size: 22px; margin: 0 0 8px;">Heads up — we'll pay your ticket in 21 days</h1>
      <p style="font-size: 15px; line-height: 1.6;">Hi ${fname},</p>
      <p style="font-size: 15px; line-height: 1.6;">
        Your contest for ${ticketLabel} was decided against you, and the city wants <strong>${amount}</strong>.
        Because you have Late Fee Protection on, <strong>we'll charge your card on file and pay the city for you on ${chargeDate}</strong> — 21 days from now.
      </p>
      <p style="font-size: 15px; line-height: 1.6;">
        We give you 21 days so you have time to file an appeal with the city if you want to, or to pay the ticket yourself. Chicago's pay-or-contest deadline is 25 days after a finding of liability — we leave a 4-day buffer so the charge still lands before late fees can double the fine.
      </p>
      <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <strong style="color: #78350f;">Want to appeal, or pay it yourself?</strong>
        <p style="font-size: 14px; color: #78350f; margin: 6px 0 0;">
          Turn off Late Fee Protection for this ticket any time before ${chargeDate}:
          <br>
          <a href="${params.cancelUrl}" style="color: #0052cc;">${params.cancelUrl}</a>
        </p>
      </div>
      <p style="font-size: 14px; color: #6b7280; line-height: 1.6;">
        If you do nothing, we'll charge your card for ${amount} on ${chargeDate} and pay the city. You'll get a receipt email once it's done.
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
        Questions? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
      </p>
    </div>
  `;
  const text = `Hi ${fname},

Your contest for ${ticketLabel} was decided against you. The city wants ${amount}.

Because you have Late Fee Protection on, we'll charge your card and pay the city on ${chargeDate} — 21 days from now.

We give you 21 days so you have time to file an appeal with the city if you want to, or to pay the ticket yourself. Chicago's pay-or-contest deadline is 25 days after a finding of liability; we leave a 4-day buffer so the charge still lands before late fees can double the fine.

If you'd rather pay the city yourself, or you want to appeal, turn Late Fee Protection off for this ticket any time before ${chargeDate}:
${params.cancelUrl}

If you do nothing, we'll charge your card for ${amount} on ${chargeDate} and pay the city. Receipt to follow.

Questions? ${SUPPORT_EMAIL}`;

  await sendResendEmail({
    to: params.to,
    subject: `Heads up — we'll auto-pay your ${amount} ticket in 21 days`,
    html,
    text,
  });

  // Admin notification: every pre-charge email gets a CC to randyvollrath@gmail.com
  // so a real autopay about to fire is visible. Lets us intervene during the
  // 21-day grace window if anything looks wrong.
  await sendResendEmail({
    to: 'randyvollrath@gmail.com',
    subject: `[Autopay heads-up] ${params.to} - ${amount} in 21 days`,
    html: `<p><strong>Pre-charge notice sent to user.</strong></p>
      <p>User: ${params.to}</p>
      <p>Ticket: ${ticketLabel}</p>
      <p>Amount: ${amount}</p>
      <p>Scheduled charge: ${chargeDate}</p>
      <p>This is the 21-day heads-up. The user has until then to appeal, pay the city themselves, or opt out via /account/autopay.</p>`,
    text: `Pre-charge notice sent to ${params.to} for ${amount} (${ticketLabel}). Scheduled charge: ${chargeDate}. User has 21 days to appeal/opt-out.`,
  }).catch((e) => console.error('admin pre-charge cc failed:', e?.message || e));
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
