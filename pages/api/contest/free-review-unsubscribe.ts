/**
 * GET /api/contest/free-review-unsubscribe?token=<hex>
 *
 * One-click unsubscribe link for all follow-up emails on a free-review
 * row: weekly recheck "new ticket detected" AND the educational drip
 * (Day 3 / Day 7). Flips monitor_enabled=false AND drip_unsubscribed=true.
 *
 * The user's original review row is left untouched — they can still come
 * back to /free-ticket-review?id=<uuid> and see their analysis. We're only
 * turning off the follow-up emails.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TOKEN_RE = /^[a-f0-9]{32,96}$/i;

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Autopilot America</title>
  <meta name="robots" content="noindex">
  <style>
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #0F172A; max-width: 560px; margin: 60px auto; padding: 0 24px; line-height: 1.6; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p  { font-size: 15px; color: #334155; }
    a  { color: #2563EB; }
  </style>
</head><body>
  ${body}
</body></html>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.query.token || '').toString();
  if (!TOKEN_RE.test(token)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(htmlPage('Invalid unsubscribe link', `
      <h1>That unsubscribe link looks wrong.</h1>
      <p>The link in our email may have been mangled by your mail client. If you keep seeing recheck emails you don't want, just reply to the last one and we'll turn it off for you by hand.</p>
    `));
  }

  const { data: row, error: lookupErr } = await supabase
    .from('free_review_requests')
    .select('id, plate, monitor_enabled, monitor_stopped_reason, drip_unsubscribed')
    .eq('unsubscribe_token', token)
    .maybeSingle();

  if (lookupErr) {
    console.error('[free-review-unsubscribe] lookup error', lookupErr);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(htmlPage('Something went wrong', `
      <h1>Something went wrong on our end.</h1>
      <p>Refresh the page in a minute. If it still won't unsubscribe you, reply to the last email and we'll handle it manually.</p>
    `));
  }

  if (!row) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(htmlPage('Already unsubscribed', `
      <h1>You're already off the list.</h1>
      <p>We couldn't find an active recheck subscription for that link. You won't get any more recheck emails — your original review is unaffected.</p>
      <p><a href="/free-ticket-review">Run another free ticket review →</a></p>
    `));
  }

  // Already off on both axes? Show the confirmation page and short-circuit.
  if (row.monitor_enabled === false && row.drip_unsubscribed === true) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(htmlPage('Already unsubscribed', `
      <h1>You're already off the list for plate ${row.plate}.</h1>
      <p>No more follow-up emails of any kind. Your original review at <a href="/free-ticket-review?id=${row.id}">/free-ticket-review?id=${row.id}</a> is still there if you want to look at it.</p>
    `));
  }

  const { error: updateErr } = await supabase
    .from('free_review_requests')
    .update({
      monitor_enabled: false,
      monitor_stopped_reason: 'unsubscribed',
      monitor_stopped_at: new Date().toISOString(),
      drip_unsubscribed: true,
    })
    .eq('id', row.id);

  if (updateErr) {
    console.error('[free-review-unsubscribe] update error', updateErr);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(htmlPage('Something went wrong', `
      <h1>Something went wrong on our end.</h1>
      <p>Refresh the page in a minute. If it still won't unsubscribe you, reply to the last email and we'll handle it manually.</p>
    `));
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(htmlPage('Unsubscribed', `
    <h1>Unsubscribed — we'll stop all follow-up emails for plate ${row.plate}.</h1>
    <p>No more weekly rechecks, no more drip emails. Your original review at <a href="/free-ticket-review?id=${row.id}">/free-ticket-review?id=${row.id}</a> is still there.</p>
    <p>If you ever want ongoing protection again — contest filing, FOIA, street-cleaning alerts — Autopilot is $99/year. <a href="/get-started">Start Autopilot →</a></p>
  `));
}
