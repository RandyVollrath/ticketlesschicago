import { getAutopayBetaConfig } from './autopay-beta';

/**
 * Severities:
 *   'info'      — informational (test mode, normal flow events)
 *   'warning'   — something needs operator attention soon (stuck job, retry)
 *   'emergency' — user money is on the line right now; investigate immediately.
 *                 Subject is prefixed [EMERGENCY] and a copy goes to randyvollrath@gmail.com.
 */
type AlertSeverity = 'info' | 'warning' | 'emergency';

export async function sendAutopayOperatorAlert(params: {
  subject: string;
  html: string;
  text: string;
  severity?: AlertSeverity;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const baseTo = getAutopayBetaConfig().alertsTo;
  const severity: AlertSeverity = params.severity || 'warning';

  // Emergencies always cc randy's personal email so a phone notification fires
  // even if the alerts@ inbox isn't being watched.
  const emergencyEscalation = ['randyvollrath@gmail.com'];
  const to = severity === 'emergency'
    ? Array.from(new Set([...baseTo, ...emergencyEscalation]))
    : baseTo;

  if (!apiKey || to.length === 0) {
    console.warn('Skipping autopay operator alert: RESEND_API_KEY or recipient list missing');
    return;
  }

  const subject = severity === 'emergency'
    ? `[EMERGENCY] ${params.subject}`
    : params.subject;

  const banner = severity === 'emergency'
    ? `<div style="background:#dc2626;color:#fff;padding:14px;border-radius:6px;font-weight:bold;margin-bottom:14px;">🚨 EMERGENCY — autopay incident affecting a real user. Investigate now. The 48h auto-refund cron will protect the user financially, but their ticket may still be unpaid until you act.</div>`
    : '';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to,
      subject,
      html: `${banner}${params.html}`,
      text: severity === 'emergency'
        ? `🚨 EMERGENCY — autopay incident.\n\n${params.text}`
        : params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend alert failed: ${response.status} ${body}`.trim());
  }
}
