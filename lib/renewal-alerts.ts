// Operator alerts for the auto-renewal pipeline. Pages randyvollrath@gmail.com
// via Resend when an automation breaks or when a sentinel probe fails.

const ADMIN_EMAIL = 'randyvollrath@gmail.com';

export interface RenewalAlertInput {
  subject: string;
  body: string;
  severity?: 'warning' | 'emergency';
}

export async function sendRenewalOperatorAlert(input: RenewalAlertInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[renewal-alerts] RESEND_API_KEY missing; alert dropped:', input.subject);
    return;
  }
  const severity = input.severity || 'warning';
  const prefix = severity === 'emergency' ? '[EMERGENCY] ' : '';
  const subject = `${prefix}[Auto-renew] ${input.subject}`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [ADMIN_EMAIL],
        subject,
        text: input.body,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error('[renewal-alerts] Resend error', resp.status, t);
    }
  } catch (e) {
    console.error('[renewal-alerts] fetch failed', e);
  }
}
