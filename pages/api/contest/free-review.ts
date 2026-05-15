/**
 * Free Ticket Contest Review — public, unauthenticated API.
 *
 * POST  /api/contest/free-review  { plate, state, last_name, email? }
 *   → enqueues a row in free_review_requests, returns { id, status: 'pending' }
 *
 * GET   /api/contest/free-review?id=<uuid>
 *   → returns the row's current status; when status='done', returns analysis
 *
 * The actual portal lookup + analysis happens in
 * scripts/process-free-review-queue.ts (runs outside Vercel because Playwright
 * is required for the CHI PAY scrape).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PLATE_RE = /^[A-Z0-9]{2,8}$/;
const STATE_RE = /^[A-Z]{2}$/;

// Throttle per-IP enqueue rate so this can't be used to DoS the city portal
// through us. Records the count in the table itself rather than a separate
// store; 3 active (pending+processing) requests from one IP is the cap.
const PER_IP_INFLIGHT_CAP = 3;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      return await handleEnqueue(req, res);
    }
    if (req.method === 'GET') {
      return await handleStatus(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[free-review] handler error', err);
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
}

async function handleEnqueue(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body || {};
  const rawPlate: string = (body.plate || '').toString().trim().toUpperCase().replace(/[\s-]/g, '');
  const rawState: string = (body.state || 'IL').toString().trim().toUpperCase();
  const rawLastName: string = (body.last_name || body.lastName || '').toString().trim();
  const rawEmail: string | null = body.email ? body.email.toString().trim().toLowerCase() : null;
  // Monitor flag: keep watching the plate weekly and email on new tickets.
  // Only honored when we actually have an email — silently false otherwise.
  const wantsMonitor: boolean = !!body.monitor && !!rawEmail;

  if (!PLATE_RE.test(rawPlate)) {
    return res.status(400).json({ error: 'Plate must be 2–8 letters and digits.' });
  }
  if (!STATE_RE.test(rawState)) {
    return res.status(400).json({ error: 'State must be a 2-letter abbreviation (e.g. IL).' });
  }
  if (rawLastName.length < 2 || rawLastName.length > 60) {
    return res.status(400).json({ error: 'Last name must be 2–60 characters.' });
  }
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ error: 'Email is not valid.' });
  }

  const ip = getClientIp(req);

  // Per-IP inflight cap
  if (ip) {
    const { count } = await supabaseAdmin
      .from('free_review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .in('status', ['pending', 'processing']);
    if ((count || 0) >= PER_IP_INFLIGHT_CAP) {
      return res.status(429).json({
        error: `You already have ${count} review${count === 1 ? '' : 's'} in progress. Please wait for those to finish before submitting another.`,
      });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('free_review_requests')
    .insert({
      plate: rawPlate,
      state: rawState,
      last_name: rawLastName,
      email: rawEmail,
      ip,
      user_agent: (req.headers['user-agent'] || '').toString().slice(0, 500),
      status: 'pending',
      monitor_enabled: wantsMonitor,
      // Pre-generate the unsubscribe token even when monitoring is off, so
      // it's already there if the user is later moved into monitoring (e.g.
      // by an admin) without us having to backfill.
      unsubscribe_token: randomBytes(24).toString('hex'),
    })
    .select('id, status, created_at')
    .single();

  if (error || !data) {
    console.error('[free-review] enqueue failed', error);
    return res.status(500).json({ error: 'Could not enqueue review.' });
  }

  return res.status(202).json({
    id: data.id,
    status: data.status,
    created_at: data.created_at,
    estimatedWaitSeconds: 60, // worst case: ~14s scrape + queue wait
  });
}

async function handleStatus(req: NextApiRequest, res: NextApiResponse) {
  const id = (req.query.id || '').toString();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'Missing or invalid id.' });
  }

  const { data, error } = await supabaseAdmin
    .from('free_review_requests')
    .select('id, status, error_message, plate, state, analysis, created_at, completed_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'Lookup failed.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Review not found.' });
  }

  // Trim what we send back: only return analysis when status='done'.
  // For in-progress rows, also include queue position + worker liveness so
  // the page can show an honest ETA instead of just spinning.
  if (data.status !== 'done') {
    const [queue, hb] = await Promise.all([
      supabaseAdmin
        .from('free_review_requests')
        .select('id, status, created_at')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('free_review_worker_heartbeat')
        .select('worker_id, last_seen_at')
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const rows = queue.data || [];
    const position = Math.max(1, rows.findIndex(r => r.id === data.id) + 1);
    const ahead = Math.max(0, position - 1);
    // ~25 seconds per lookup including queue overhead — what we see in
    // practice on the CHI PAY portal. Used only for display.
    const etaSeconds = Math.max(15, ahead * 25 + 20);
    const heartbeatAgeMs = hb.data?.last_seen_at
      ? Date.now() - new Date(hb.data.last_seen_at).getTime()
      : null;
    const workerLive = heartbeatAgeMs != null && heartbeatAgeMs < 2 * 60 * 1000;
    return res.status(200).json({
      id: data.id,
      status: data.status,
      created_at: data.created_at,
      error_message: data.error_message,
      queue: {
        position,
        ahead,
        etaSeconds,
        workerLive,
        heartbeatAgeMs,
      },
    });
  }

  return res.status(200).json({
    id: data.id,
    status: data.status,
    plate: data.plate,
    state: data.state,
    analysis: data.analysis || null,
    completed_at: data.completed_at,
    created_at: data.created_at,
  });
}

function getClientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0];
  }
  return req.socket?.remoteAddress || null;
}
