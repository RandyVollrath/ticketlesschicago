import { getAutopayBetaConfig } from './autopay-beta';

export async function sendAutopayOperatorAlert(params: {
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = getAutopayBetaConfig().alertsTo;

  if (!apiKey || to.length === 0) {
    console.warn('Skipping autopay operator alert: RESEND_API_KEY or recipient list missing');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend alert failed: ${response.status} ${body}`.trim());
  }
}
