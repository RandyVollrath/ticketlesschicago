/**
 * Trigger an on-demand run of the Autopilot mailing cron.
 * Used when evidence arrives and we want same-day letter mailing.
 */
export async function triggerAutopilotMailRun(context: {
  ticketId?: string;
  reason: string;
}): Promise<{ triggered: boolean; status?: number; message: string }> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return {
      triggered: false,
      message: 'CRON_SECRET missing; cannot trigger on-demand mailing run',
    };
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const url = new URL('/api/cron/autopilot-mail-letters', baseUrl);
  url.searchParams.set('key', cronSecret);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'x-trigger-reason': context.reason,
        ...(context.ticketId ? { 'x-ticket-id': context.ticketId } : {}),
      },
    });

    return {
      triggered: response.ok,
      status: response.status,
      message: response.ok
        ? 'Triggered on-demand mailing run'
        : `Mailing run trigger failed (${response.status})`,
    };
  } catch (error: any) {
    return {
      triggered: false,
      message: `Mailing run trigger error: ${error?.message || 'unknown error'}`,
    };
  }
}

