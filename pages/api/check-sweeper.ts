/**
 * Real-time sweeper check API
 *
 * Checks whether the city's street sweeper has passed a specific block today.
 * Used by the mobile app to notify users "sweeper passed — you can move your car back."
 *
 * POST /api/check-sweeper
 * Body: { address: "2300 N SHEFFIELD AVE" }
 * Response: {
 *   passed: boolean,
 *   segment: string | null,
 *   passTime: string | null,   // e.g. "10:28 AM"
 *   vehicleId: string | null,
 *   totalPingsToday: number,
 *   seasonActive: boolean,     // false Nov-March (no sweeping)
 * }
 *
 * Also supports checking a specific date for contest evidence:
 * Body: { address: "2300 N SHEFFIELD AVE", date: "2026-03-10" }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, handleAuthError } from '../../lib/auth-middleware';
import { checkSweeperPassedToday, verifySweeperVisit } from '../../lib/sweeper-tracker';
import { sanitizeErrorMessage } from '../../lib/error-utils';

/** Street sweeping season is roughly April 1 - November 30 */
function isSweeperSeason(): boolean {
  const now = new Date();
  // Get Chicago month (0-indexed)
  const chicagoMonth = parseInt(
    now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'numeric' })
  );
  // Season is April (4) through November (11)
  return chicagoMonth >= 4 && chicagoMonth <= 11;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication
  let user;
  try {
    user = await requireAuth(req);
  } catch (error: any) {
    return handleAuthError(res, error);
  }

  const { address, date } = req.body || {};

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid address' });
  }

  // Basic length/content validation
  if (address.length > 200) {
    return res.status(400).json({ error: 'Address too long' });
  }

  try {
    const seasonActive = isSweeperSeason();

    // If a specific date is provided, use the full verification (for contest evidence)
    if (date && typeof date === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
      }

      const verification = await verifySweeperVisit(address, date);
      return res.status(200).json({
        success: true,
        mode: 'historical',
        seasonActive,
        transId: verification.transId,
        segment: verification.streetSegment,
        sweptOnDate: verification.sweptOnDate,
        firstPassTime: verification.firstSweeperPassTime,
        lastPassTime: verification.lastSweeperPassTime,
        totalVisits: verification.visitsOnDate.length,
        allRecentVisits: verification.allRecentVisits.length,
        message: verification.message,
        error: verification.error,
      });
    }

    // Real-time check: has sweeper passed today?
    const result = await checkSweeperPassedToday(address);

    if (!result) {
      return res.status(200).json({
        success: true,
        mode: 'realtime',
        seasonActive,
        passed: false,
        segment: null,
        passTime: null,
        vehicleId: null,
        totalPingsToday: 0,
        message: seasonActive
          ? 'Could not find this address in Chicago\'s street network.'
          : 'Street sweeping is not active (season runs April-November).',
      });
    }

    return res.status(200).json({
      success: true,
      mode: 'realtime',
      seasonActive,
      passed: result.passed,
      transId: result.transId,
      segment: result.segment,
      passTime: result.passTime,
      passTimeUtc: result.passTimeUtc,
      vehicleId: result.vehicleId,
      totalPingsToday: result.totalPingsToday,
      message: result.passed
        ? `Sweeper passed ${result.segment} today at ${result.passTime}. You can move your car back.`
        : seasonActive
          ? `No sweeper has passed ${result.segment} yet today. We'll keep checking.`
          : `Street sweeping is not active (season runs April-November).`,
    });

  } catch (error) {
    console.error('Sweeper check error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}
