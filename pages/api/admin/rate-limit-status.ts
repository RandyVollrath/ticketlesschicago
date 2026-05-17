/**
 * Admin diagnostic: report which rate-limit backend is active and ping it
 * for a round-trip latency number. Lets us confirm Upstash is actually
 * wired up without having to exhaust a real limit.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminAuth } from '../../../lib/auth-middleware';
import { rateLimitBackend, checkAndIncrement } from '../../../lib/rate-limit-backend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const backend = rateLimitBackend();
  const start = Date.now();
  let probe: any;
  try {
    // One-off increment under a throwaway key so we exercise the real
    // backend round-trip without polluting any real limit.
    probe = await checkAndIncrement(`status-probe-${Date.now()}`, 'diagnostic', 1000, 60_000);
  } catch (err) {
    return res.status(500).json({ backend, error: sanitizeErrorMessage(err) });
  }
  const latencyMs = Date.now() - start;
  return res.status(200).json({ backend, latencyMs, probe });
}
