// @ts-nocheck
/**
 * Success Visibility Dashboard
 *
 * Provides platform-wide and user-specific statistics
 * to demonstrate contest success rates and savings.
 */

import { createClient } from '@supabase/supabase-js';
import {
  PlatformMetrics,
  UserContestMetrics,
  Badge,
} from './types';

// Badge definitions
const BADGE_DEFINITIONS: Record<string, Omit<Badge, 'earned_at'>> = {
  first_win: {
    id: 'first_win',
    name: 'First Victory',
    description: 'Won your first ticket contest',
    icon: '🏆',
  },
  three_wins: {
    id: 'three_wins',
    name: 'Hat Trick',
    description: 'Won 3 ticket contests',
    icon: '🎩',
  },
  five_wins: {
    id: 'five_wins',
    name: 'High Five',
    description: 'Won 5 ticket contests',
    icon: '✋',
  },
  ten_wins: {
    id: 'ten_wins',
    name: 'Perfect 10',
    description: 'Won 10 ticket contests',
    icon: '🔟',
  },
  twenty_five_wins: {
    id: 'twenty_five_wins',
    name: 'Quarter Century',
    description: 'Won 25 ticket contests',
    icon: '🥈',
  },
  fifty_wins: {
    id: 'fifty_wins',
    name: 'Half Century',
    description: 'Won 50 ticket contests',
    icon: '🥇',
  },
  hundred_saved: {
    id: 'hundred_saved',
    name: 'Benjamins',
    description: 'Saved over $100 on tickets',
    icon: '💵',
  },
  five_hundred_saved: {
    id: 'five_hundred_saved',
    name: 'Big Saver',
    description: 'Saved over $500 on tickets',
    icon: '💰',
  },
  thousand_saved: {
    id: 'thousand_saved',
    name: 'Grand Master',
    description: 'Saved over $1,000 on tickets',
    icon: '🤑',
  },
  perfect_record: {
    id: 'perfect_record',
    name: 'Undefeated',
    description: 'Maintained 100% win rate with 3+ contests',
    icon: '🏅',
  },
  three_streak: {
    id: 'three_streak',
    name: 'Hot Streak',
    description: 'Won 3 contests in a row',
    icon: '🔥',
  },
  five_streak: {
    id: 'five_streak',
    name: 'On Fire',
    description: 'Won 5 contests in a row',
    icon: '🌟',
  },
  evidence_master: {
    id: 'evidence_master',
    name: 'Evidence Master',
    description: 'Submitted evidence for 10 contests',
    icon: '📸',
  },
  early_bird: {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'Contested a ticket within 24 hours of receiving it',
    icon: '🐦',
  },
  community_helper: {
    id: 'community_helper',
    name: 'Community Helper',
    description: 'Reported 5 signage issues',
    icon: '🤝',
  },
};

/**
 * Get platform-wide metrics for today
 */
export async function getTodaysPlatformMetrics(
  supabase: ReturnType<typeof createClient>
): Promise<PlatformMetrics | null> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('platform_metrics')
    .select('*')
    .eq('metric_date', today)
    .single();

  if (error || !data) {
    // Generate metrics if not found
    return generatePlatformMetrics(supabase, today);
  }

  return mapToPlatformMetrics(data);
}

/**
 * Get platform metrics for a date range
 */
export async function getPlatformMetricsRange(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string
): Promise<PlatformMetrics[]> {
  const { data, error } = await supabase
    .from('platform_metrics')
    .select('*')
    .gte('metric_date', startDate)
    .lte('metric_date', endDate)
    .order('metric_date', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map(mapToPlatformMetrics);
}

/**
 * Generate platform metrics for a specific date
 */
async function generatePlatformMetrics(
  supabase: ReturnType<typeof createClient>,
  date: string
): Promise<PlatformMetrics | null> {
  // Get contest outcomes for calculations
  const { data: outcomes } = await supabase
    .from('contest_outcomes')
    .select('*');

  if (!outcomes) return null;

  // Calculate totals
  let totalContests = 0;
  let contestsWon = 0;
  let contestsLost = 0;
  let contestsPending = 0;
  let totalFinesContested = 0;
  let totalSavings = 0;

  const violationStats: Record<string, { wins: number; total: number }> = {};
  const wardStats: Record<string, { wins: number; total: number }> = {};
  const defenseStats: Record<string, { wins: number; total: number }> = {};

  for (const outcome of outcomes) {
    totalContests += 1;
    if (outcome.original_amount) totalFinesContested += outcome.original_amount;

    const won = outcome.outcome === 'dismissed' || outcome.outcome === 'reduced';

    if (won) {
      contestsWon += 1;
      if (outcome.amount_saved) totalSavings += outcome.amount_saved;
    } else if (outcome.outcome === 'upheld') {
      contestsLost += 1;
    } else {
      contestsPending += 1;
    }

    // Violation stats
    if (outcome.violation_type) {
      if (!violationStats[outcome.violation_type]) {
        violationStats[outcome.violation_type] = { wins: 0, total: 0 };
      }
      violationStats[outcome.violation_type].total += 1;
      if (won) violationStats[outcome.violation_type].wins += 1;
    }

    // Ward stats
    if (outcome.ward) {
      const wardKey = outcome.ward.toString();
      if (!wardStats[wardKey]) {
        wardStats[wardKey] = { wins: 0, total: 0 };
      }
      wardStats[wardKey].total += 1;
      if (won) wardStats[wardKey].wins += 1;
    }

    // Defense stats
    if (outcome.primary_defense) {
      if (!defenseStats[outcome.primary_defense]) {
        defenseStats[outcome.primary_defense] = { wins: 0, total: 0 };
      }
      defenseStats[outcome.primary_defense].total += 1;
      if (won) defenseStats[outcome.primary_defense].wins += 1;
    }
  }

  // Calculate win rates
  const winRatesByViolation: Record<string, number> = {};
  for (const [violation, stats] of Object.entries(violationStats)) {
    winRatesByViolation[violation] = stats.total > 0 ? stats.wins / stats.total : 0;
  }

  const winRatesByWard: Record<string, number> = {};
  for (const [ward, stats] of Object.entries(wardStats)) {
    winRatesByWard[ward] = stats.total > 0 ? stats.wins / stats.total : 0;
  }

  const winRatesByDefense: Record<string, number> = {};
  for (const [defense, stats] of Object.entries(defenseStats)) {
    winRatesByDefense[defense] = stats.total > 0 ? stats.wins / stats.total : 0;
  }

  // Get user counts (this would need a users table or auth data)
  // For now, count unique user_ids in outcomes
  const uniqueUsers = new Set(outcomes.map(o => o.user_id));

  const metrics: Omit<PlatformMetrics, 'id' | 'created_at'> = {
    metric_date: date,
    total_contests_filed: totalContests,
    contests_won: contestsWon,
    contests_lost: contestsLost,
    contests_pending: contestsPending,
    total_fines_contested: totalFinesContested,
    total_savings: totalSavings,
    average_savings_per_win: contestsWon > 0 ? totalSavings / contestsWon : undefined,
    win_rates_by_violation: winRatesByViolation,
    win_rates_by_ward: winRatesByWard,
    win_rates_by_defense: winRatesByDefense,
    active_users: uniqueUsers.size,
    new_users: 0, // Would need registration date tracking
    tickets_per_user: uniqueUsers.size > 0 ? totalContests / uniqueUsers.size : undefined,
    letters_generated: totalContests, // Approximation
    letters_mailed: 0, // Would need mail tracking
    letters_delivered: 0, // Would need delivery tracking
    evidence_submitted: 0, // Would need evidence count
    avg_evidence_per_contest: undefined,
    avg_days_to_outcome: undefined,
  };

  // Store the metrics
  const { data, error } = await supabase
    .from('platform_metrics')
    .upsert({
      ...metrics,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    return null;
  }

  return mapToPlatformMetrics(data);
}

/**
 * Get user contest metrics
 */
export async function getUserContestMetrics(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<UserContestMetrics | null> {
  // Try to get cached metrics first
  const { data: cachedData } = await supabase
    .from('user_contest_metrics')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (cachedData) {
    return mapToUserMetrics(cachedData);
  }

  // Generate metrics from outcomes
  return generateUserMetrics(supabase, userId);
}

/**
 * Generate user metrics from outcomes
 */
async function generateUserMetrics(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<UserContestMetrics | null> {
  const { data: outcomes } = await supabase
    .from('contest_outcomes')
    .select('*')
    .eq('user_id', userId)
    .order('outcome_date', { ascending: true });

  if (!outcomes || outcomes.length === 0) {
    return {
      user_id: userId,
      total_contests: 0,
      total_wins: 0,
      total_losses: 0,
      win_rate: 0,
      total_fines_faced: 0,
      total_savings: 0,
      total_paid: 0,
      current_win_streak: 0,
      longest_win_streak: 0,
      stats_by_violation: {},
      badges: [],
      updated_at: new Date().toISOString(),
    };
  }

  let totalWins = 0;
  let totalLosses = 0;
  let totalFinesFaced = 0;
  let totalSavings = 0;
  let totalPaid = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let lastContestDate: string | undefined;
  let lastWinDate: string | undefined;

  const violationStats: Record<string, { contests: number; wins: number }> = {};
  const earnedBadges: Badge[] = [];

  for (const outcome of outcomes) {
    if (outcome.original_amount) totalFinesFaced += outcome.original_amount;

    const won = outcome.outcome === 'dismissed' || outcome.outcome === 'reduced';

    if (won) {
      totalWins += 1;
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      if (outcome.amount_saved) totalSavings += outcome.amount_saved;
      lastWinDate = outcome.outcome_date || outcome.created_at;
    } else if (outcome.outcome === 'upheld') {
      totalLosses += 1;
      currentStreak = 0;
      if (outcome.final_amount) totalPaid += outcome.final_amount;
    }

    lastContestDate = outcome.outcome_date || outcome.created_at;

    // Track by violation
    if (outcome.violation_type) {
      if (!violationStats[outcome.violation_type]) {
        violationStats[outcome.violation_type] = { contests: 0, wins: 0 };
      }
      violationStats[outcome.violation_type].contests += 1;
      if (won) violationStats[outcome.violation_type].wins += 1;
    }
  }

  // Calculate violation win rates
  const statsByViolation: Record<string, { contests: number; wins: number; win_rate: number }> = {};
  for (const [violation, stats] of Object.entries(violationStats)) {
    statsByViolation[violation] = {
      ...stats,
      win_rate: stats.contests > 0 ? stats.wins / stats.contests : 0,
    };
  }

  // Determine badges
  if (totalWins >= 1) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.first_win, earned_at: lastWinDate || new Date().toISOString() });
  }
  if (totalWins >= 3) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.three_wins, earned_at: new Date().toISOString() });
  }
  if (totalWins >= 5) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.five_wins, earned_at: new Date().toISOString() });
  }
  if (totalWins >= 10) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.ten_wins, earned_at: new Date().toISOString() });
  }
  if (totalWins >= 25) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.twenty_five_wins, earned_at: new Date().toISOString() });
  }
  if (totalWins >= 50) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.fifty_wins, earned_at: new Date().toISOString() });
  }
  if (totalSavings >= 100) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.hundred_saved, earned_at: new Date().toISOString() });
  }
  if (totalSavings >= 500) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.five_hundred_saved, earned_at: new Date().toISOString() });
  }
  if (totalSavings >= 1000) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.thousand_saved, earned_at: new Date().toISOString() });
  }
  if (outcomes.length >= 3 && totalLosses === 0) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.perfect_record, earned_at: new Date().toISOString() });
  }
  if (longestStreak >= 3) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.three_streak, earned_at: new Date().toISOString() });
  }
  if (longestStreak >= 5) {
    earnedBadges.push({ ...BADGE_DEFINITIONS.five_streak, earned_at: new Date().toISOString() });
  }

  const metrics: UserContestMetrics = {
    user_id: userId,
    total_contests: outcomes.length,
    total_wins: totalWins,
    total_losses: totalLosses,
    win_rate: outcomes.length > 0 ? totalWins / outcomes.length : 0,
    total_fines_faced: totalFinesFaced,
    total_savings: totalSavings,
    total_paid: totalPaid,
    current_win_streak: currentStreak,
    longest_win_streak: longestStreak,
    stats_by_violation: statsByViolation,
    badges: earnedBadges,
    last_contest_date: lastContestDate,
    last_win_date: lastWinDate,
    updated_at: new Date().toISOString(),
  };

  // Cache the metrics
  await supabase.from('user_contest_metrics').upsert({
    user_id: userId,
    total_contests: metrics.total_contests,
    total_wins: metrics.total_wins,
    total_losses: metrics.total_losses,
    win_rate: metrics.win_rate,
    total_fines_faced: metrics.total_fines_faced,
    total_savings: metrics.total_savings,
    total_paid: metrics.total_paid,
    current_win_streak: metrics.current_win_streak,
    longest_win_streak: metrics.longest_win_streak,
    stats_by_violation: metrics.stats_by_violation,
    badges: metrics.badges,
    last_contest_date: metrics.last_contest_date,
    last_win_date: metrics.last_win_date,
    updated_at: metrics.updated_at,
  });

  return metrics;
}

/**
 * Get leaderboard of top users by win count
 */
export async function getWinLeaderboard(
  supabase: ReturnType<typeof createClient>,
  limit: number = 10
): Promise<Array<{ rank: number; user_id: string; total_wins: number; win_rate: number; total_savings: number }>> {
  const { data, error } = await supabase
    .from('user_contest_metrics')
    .select('user_id, total_wins, win_rate, total_savings')
    .order('total_wins', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data.map((row, index) => ({
    rank: index + 1,
    user_id: row.user_id,
    total_wins: row.total_wins,
    win_rate: row.win_rate,
    total_savings: row.total_savings,
  }));
}

/**
 * Get leaderboard by savings
 */
export async function getSavingsLeaderboard(
  supabase: ReturnType<typeof createClient>,
  limit: number = 10
): Promise<Array<{ rank: number; user_id: string; total_savings: number; total_wins: number }>> {
  const { data, error } = await supabase
    .from('user_contest_metrics')
    .select('user_id, total_savings, total_wins')
    .order('total_savings', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data.map((row, index) => ({
    rank: index + 1,
    user_id: row.user_id,
    total_savings: row.total_savings,
    total_wins: row.total_wins,
  }));
}

/**
 * Get summary statistics for the dashboard
 */
export async function getDashboardSummary(
  supabase: ReturnType<typeof createClient>
): Promise<{
  total_users: number;
  total_contests: number;
  overall_win_rate: number;
  total_savings: number;
  top_violation_win_rate: { violation: string; rate: number };
  top_ward_win_rate: { ward: number; rate: number };
  recent_wins: number;
}> {
  const metrics = await getTodaysPlatformMetrics(supabase);

  let topViolation = { violation: 'unknown', rate: 0 };
  let topWard = { ward: 0, rate: 0 };

  if (metrics) {
    // Find top violation
    for (const [violation, rate] of Object.entries(metrics.win_rates_by_violation)) {
      if (rate > topViolation.rate) {
        topViolation = { violation, rate };
      }
    }

    // Find top ward
    for (const [ward, rate] of Object.entries(metrics.win_rates_by_ward)) {
      if (rate > topWard.rate) {
        topWard = { ward: parseInt(ward), rate };
      }
    }
  }

  // Get recent wins (last 7 days)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { count: recentWins } = await supabase
    .from('contest_outcomes')
    .select('*', { count: 'exact', head: true })
    .in('outcome', ['dismissed', 'reduced'])
    .gte('outcome_date', weekAgo.toISOString());

  return {
    total_users: metrics?.active_users || 0,
    total_contests: metrics?.total_contests_filed || 0,
    overall_win_rate: metrics && metrics.total_contests_filed > 0
      ? metrics.contests_won / metrics.total_contests_filed
      : 0,
    total_savings: metrics?.total_savings || 0,
    top_violation_win_rate: topViolation,
    top_ward_win_rate: topWard,
    recent_wins: recentWins || 0,
  };
}

/**
 * Get user's rank among all users
 */
export async function getUserRank(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ wins_rank: number; savings_rank: number; total_users: number }> {
  const userMetrics = await getUserContestMetrics(supabase, userId);

  if (!userMetrics) {
    return { wins_rank: 0, savings_rank: 0, total_users: 0 };
  }

  // Count users with more wins
  const { count: winsAbove } = await supabase
    .from('user_contest_metrics')
    .select('*', { count: 'exact', head: true })
    .gt('total_wins', userMetrics.total_wins);

  // Count users with more savings
  const { count: savingsAbove } = await supabase
    .from('user_contest_metrics')
    .select('*', { count: 'exact', head: true })
    .gt('total_savings', userMetrics.total_savings);

  // Count total users
  const { count: totalUsers } = await supabase
    .from('user_contest_metrics')
    .select('*', { count: 'exact', head: true });

  return {
    wins_rank: (winsAbove || 0) + 1,
    savings_rank: (savingsAbove || 0) + 1,
    total_users: totalUsers || 0,
  };
}

/**
 * Get streak information for display
 */
export function formatStreakInfo(currentStreak: number, longestStreak: number): string {
  if (currentStreak === 0) {
    return longestStreak > 0
      ? `Best streak: ${longestStreak} wins in a row`
      : 'Start your winning streak!';
  }

  if (currentStreak === longestStreak) {
    return `🔥 On a ${currentStreak}-win streak (your best!)`;
  }

  return `${currentStreak}-win streak (best: ${longestStreak})`;
}

/**
 * Map database row to PlatformMetrics
 */
function mapToPlatformMetrics(data: any): PlatformMetrics {
  return {
    id: data.id,
    metric_date: data.metric_date,
    total_contests_filed: data.total_contests_filed || 0,
    contests_won: data.contests_won || 0,
    contests_lost: data.contests_lost || 0,
    contests_pending: data.contests_pending || 0,
    total_fines_contested: data.total_fines_contested || 0,
    total_savings: data.total_savings || 0,
    average_savings_per_win: data.average_savings_per_win,
    win_rates_by_violation: data.win_rates_by_violation || {},
    win_rates_by_ward: data.win_rates_by_ward || {},
    win_rates_by_defense: data.win_rates_by_defense || {},
    active_users: data.active_users || 0,
    new_users: data.new_users || 0,
    tickets_per_user: data.tickets_per_user,
    letters_generated: data.letters_generated || 0,
    letters_mailed: data.letters_mailed || 0,
    letters_delivered: data.letters_delivered || 0,
    evidence_submitted: data.evidence_submitted || 0,
    avg_evidence_per_contest: data.avg_evidence_per_contest,
    avg_days_to_outcome: data.avg_days_to_outcome,
    created_at: data.created_at,
  };
}

/**
 * Map database row to UserContestMetrics
 */
function mapToUserMetrics(data: any): UserContestMetrics {
  return {
    user_id: data.user_id,
    total_contests: data.total_contests || 0,
    total_wins: data.total_wins || 0,
    total_losses: data.total_losses || 0,
    win_rate: data.win_rate || 0,
    total_fines_faced: data.total_fines_faced || 0,
    total_savings: data.total_savings || 0,
    total_paid: data.total_paid || 0,
    current_win_streak: data.current_win_streak || 0,
    longest_win_streak: data.longest_win_streak || 0,
    stats_by_violation: data.stats_by_violation || {},
    badges: data.badges || [],
    last_contest_date: data.last_contest_date,
    last_win_date: data.last_win_date,
    updated_at: data.updated_at,
  };
}

export { BADGE_DEFINITIONS };
