import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  getTodaysPlatformMetrics,
  getPlatformMetricsRange,
  getUserContestMetrics,
  getWinLeaderboard,
  getSavingsLeaderboard,
  getDashboardSummary,
  getUserRank,
  formatStreakInfo,
  BADGE_DEFINITIONS,
} from '../../../lib/contest-intelligence';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Success Dashboard API
 *
 * GET /api/intelligence/dashboard?summary=true - Get platform summary
 * GET /api/intelligence/dashboard?platform=true - Get today's platform metrics
 * GET /api/intelligence/dashboard?platform=true&start=2024-01-01&end=2024-01-31 - Get range
 * GET /api/intelligence/dashboard?user_id=xxx - Get user metrics
 * GET /api/intelligence/dashboard?user_id=xxx&rank=true - Get user rank
 * GET /api/intelligence/dashboard?leaderboard=wins - Get wins leaderboard
 * GET /api/intelligence/dashboard?leaderboard=savings - Get savings leaderboard
 * GET /api/intelligence/dashboard?badges=true - Get all badge definitions
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const {
      summary,
      platform,
      user_id,
      rank,
      leaderboard,
      badges,
      start,
      end,
      limit,
    } = req.query;

    // Get all badge definitions
    if (badges === 'true') {
      return res.status(200).json({
        success: true,
        badges: BADGE_DEFINITIONS,
      });
    }

    // Get platform summary
    if (summary === 'true') {
      const dashboardSummary = await getDashboardSummary(supabase);
      return res.status(200).json({
        success: true,
        summary: dashboardSummary,
      });
    }

    // Get platform metrics
    if (platform === 'true') {
      if (start && end) {
        const metricsRange = await getPlatformMetricsRange(
          supabase,
          start as string,
          end as string
        );
        return res.status(200).json({
          success: true,
          metrics: metricsRange,
        });
      } else {
        const todaysMetrics = await getTodaysPlatformMetrics(supabase);
        return res.status(200).json({
          success: true,
          metrics: todaysMetrics,
        });
      }
    }

    // Get leaderboard
    if (leaderboard) {
      const leaderboardLimit = limit ? parseInt(limit as string, 10) : 10;

      if (leaderboard === 'wins') {
        const winsLeaderboard = await getWinLeaderboard(supabase, leaderboardLimit);
        return res.status(200).json({
          success: true,
          leaderboard: winsLeaderboard,
          type: 'wins',
        });
      } else if (leaderboard === 'savings') {
        const savingsLeaderboard = await getSavingsLeaderboard(supabase, leaderboardLimit);
        return res.status(200).json({
          success: true,
          leaderboard: savingsLeaderboard,
          type: 'savings',
        });
      } else {
        return res.status(400).json({
          error: 'Invalid leaderboard type. Must be "wins" or "savings"',
        });
      }
    }

    // Get user metrics
    if (user_id) {
      const userMetrics = await getUserContestMetrics(supabase, user_id as string);

      if (!userMetrics) {
        return res.status(404).json({
          error: 'User metrics not found',
          user_id,
        });
      }

      // Format streak info
      const streakInfo = formatStreakInfo(
        userMetrics.current_win_streak,
        userMetrics.longest_win_streak
      );

      // Get user rank if requested
      let userRank = null;
      if (rank === 'true') {
        userRank = await getUserRank(supabase, user_id as string);
      }

      return res.status(200).json({
        success: true,
        metrics: userMetrics,
        streak_info: streakInfo,
        rank: userRank,
      });
    }

    return res.status(400).json({
      error: 'Missing required parameters. Provide summary=true, platform=true, user_id, leaderboard, or badges=true',
    });
  } catch (error: any) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
