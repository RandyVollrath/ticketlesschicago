/**
 * Personal Parking Analytics API
 *
 * Comprehensive dashboard showing:
 * - Close calls avoided (times user was warned and moved their car)
 * - Estimated money saved from alerts
 * - Parking habits and patterns
 * - Contest statistics
 * - Lifetime value metrics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Chicago ticket fine amounts by violation type
const TICKET_FINES: Record<string, number> = {
  street_cleaning: 60,
  snow_route: 250,    // Can be $150-250 depending on violation
  winter_ban: 250,    // Overnight winter parking ban
  expired_meter: 65,
  no_city_sticker: 200,
  expired_plates: 100,
  permit_zone: 75,
  fire_hydrant: 150,
  double_parking: 100,
  bus_stop: 150,
  bike_lane: 150,
  default: 75,
};

// Tow costs
const TOW_COST = 250;  // Tow fee + storage + admin
const RELOCATION_INCONVENIENCE = 50;  // Estimated time/hassle cost

interface CloseCall {
  type: 'street_cleaning' | 'snow_route' | 'winter_ban' | 'tow_alert' | 'relocation_alert' | 'permit_zone';
  date: string;
  description: string;
  potential_fine: number;
  was_avoided: boolean;  // True if user moved car after notification
}

interface MoneySavedBreakdown {
  street_cleaning_alerts: number;
  snow_route_alerts: number;
  winter_ban_alerts: number;
  tow_alerts: number;
  contest_wins: number;
  total: number;
}

interface ParkingAnalytics {
  // Summary Stats
  member_since: string | null;
  days_as_member: number;

  // Close Calls
  total_close_calls: number;
  close_calls_avoided: number;
  close_call_rate: number;  // Percentage avoided
  recent_close_calls: CloseCall[];

  // Money Saved
  estimated_money_saved: MoneySavedBreakdown;
  average_monthly_savings: number;

  // Parking Habits
  total_parking_events: number;
  total_hours_parked: number;
  risky_parking_percentage: number;  // % in restricted zones
  favorite_day: string | null;
  favorite_time: string | null;

  // Contest Stats
  contests_filed: number;
  contests_won: number;
  contest_win_rate: number;
  contest_savings: number;

  // Achievements
  achievements: Achievement[];

  // Personalized Tips
  tips: string[];
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned_at: string | null;
  progress?: number;  // 0-100 for incomplete achievements
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify user authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Fetch all data in parallel
    const [
      parkingHistory,
      snowNotifications,
      winterNotifications,
      towAlerts,
      contestOutcomes,
      userProfile,
    ] = await Promise.all([
      // Parking history
      supabaseAdmin
        .from('parking_location_history')
        .select('parked_at, cleared_at, on_winter_ban_street, on_snow_route, street_cleaning_date, permit_zone, address')
        .eq('user_id', user.id)
        .not('address', 'ilike', '%1019 W%Fullerton%')
        .order('parked_at', { ascending: false })
        .limit(1000),

      // Snow ban notifications sent to user
      supabaseAdmin
        .from('user_snow_ban_notifications')
        .select('notification_date, sent_at, notification_type, status')
        .eq('user_id', user.id)
        .eq('status', 'sent'),

      // Winter ban notifications
      supabaseAdmin
        .from('user_winter_ban_notifications')
        .select('notification_date, sent_at, status')
        .eq('user_id', user.id)
        .eq('status', 'sent'),

      // Tow/boot alerts
      supabaseAdmin
        .from('tow_boot_alerts')
        .select('created_at, alert_type, status, tow_reason')
        .eq('user_id', user.id),

      // Contest outcomes
      supabaseAdmin
        .from('contest_outcomes')
        .select('outcome, amount_saved, original_amount, violation_type, outcome_date')
        .eq('user_id', user.id),

      // User profile for member since date
      supabaseAdmin
        .from('profiles')
        .select('created_at')
        .eq('id', user.id)
        .single(),
    ]);

    // Calculate member duration
    const memberSince = userProfile.data?.created_at || user.created_at;
    const memberSinceDate = new Date(memberSince);
    const daysAsMember = Math.floor((Date.now() - memberSinceDate.getTime()) / (1000 * 60 * 60 * 24));

    // Process parking history
    const history = parkingHistory.data || [];
    const totalParkingEvents = history.length;

    // Calculate total hours parked
    let totalHoursParked = 0;
    for (const record of history) {
      if (record.parked_at && record.cleared_at) {
        const duration = (new Date(record.cleared_at).getTime() - new Date(record.parked_at).getTime()) / (1000 * 60 * 60);
        if (duration > 0 && duration < 48) {
          totalHoursParked += duration;
        }
      }
    }

    // Calculate risky parking percentage
    const riskyParkingCount = history.filter(h =>
      h.on_winter_ban_street || h.on_snow_route || h.street_cleaning_date || h.permit_zone
    ).length;
    const riskyParkingPercentage = totalParkingEvents > 0
      ? Math.round((riskyParkingCount / totalParkingEvents) * 100)
      : 0;

    // Calculate favorite day/time
    const dayCount: Record<string, number> = {};
    const timeCount: Record<string, number> = {};
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const record of history) {
      const date = new Date(record.parked_at);
      const day = DAYS[date.getDay()];
      const hour = date.getHours();

      dayCount[day] = (dayCount[day] || 0) + 1;

      let timeOfDay = 'Night';
      if (hour >= 6 && hour < 12) timeOfDay = 'Morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'Afternoon';
      else if (hour >= 17 && hour < 21) timeOfDay = 'Evening';

      timeCount[timeOfDay] = (timeCount[timeOfDay] || 0) + 1;
    }

    const favoriteDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const favoriteTime = Object.entries(timeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Calculate close calls and money saved
    const closeCallsList: CloseCall[] = [];
    let moneySaved: MoneySavedBreakdown = {
      street_cleaning_alerts: 0,
      snow_route_alerts: 0,
      winter_ban_alerts: 0,
      tow_alerts: 0,
      contest_wins: 0,
      total: 0,
    };

    // Snow notifications = potential tickets avoided
    const snowNotifs = snowNotifications.data || [];
    for (const notif of snowNotifs) {
      const fine = TICKET_FINES.snow_route;
      moneySaved.snow_route_alerts += fine;
      closeCallsList.push({
        type: 'snow_route',
        date: notif.notification_date || notif.sent_at,
        description: `Snow route parking ban alert sent`,
        potential_fine: fine,
        was_avoided: true,  // Assume avoided since they received the alert
      });
    }

    // Winter ban notifications
    const winterNotifs = winterNotifications.data || [];
    for (const notif of winterNotifs) {
      const fine = TICKET_FINES.winter_ban;
      moneySaved.winter_ban_alerts += fine;
      closeCallsList.push({
        type: 'winter_ban',
        date: notif.notification_date || notif.sent_at,
        description: `Winter overnight parking ban alert sent`,
        potential_fine: fine,
        was_avoided: true,
      });
    }

    // Count parking on street cleaning days where user cleared before cleaning
    const streetCleaningClosesCalls = history.filter(h => {
      if (!h.street_cleaning_date || !h.cleared_at) return false;
      const cleaningDate = new Date(h.street_cleaning_date);
      const clearedAt = new Date(h.cleared_at);
      // If they cleared before 7am on cleaning day, they avoided a ticket
      return clearedAt < cleaningDate ||
        (clearedAt.toDateString() === cleaningDate.toDateString() && clearedAt.getHours() < 7);
    });

    for (const record of streetCleaningClosesCalls) {
      const fine = TICKET_FINES.street_cleaning;
      moneySaved.street_cleaning_alerts += fine;
      closeCallsList.push({
        type: 'street_cleaning',
        date: record.street_cleaning_date!,
        description: `Moved car before street cleaning at ${record.address || 'saved location'}`,
        potential_fine: fine,
        was_avoided: true,
      });
    }

    // Tow alerts where vehicle was retrieved
    const towAlertsList = towAlerts.data || [];
    for (const alert of towAlertsList) {
      if (alert.status === 'vehicle_retrieved' || alert.status === 'resolved') {
        moneySaved.tow_alerts += TOW_COST;
        closeCallsList.push({
          type: 'tow_alert',
          date: alert.created_at,
          description: `Tow alert - vehicle retrieved quickly`,
          potential_fine: TOW_COST,
          was_avoided: true,
        });
      }
    }

    // Contest wins
    const outcomes = contestOutcomes.data || [];
    let contestsWon = 0;
    let contestSavings = 0;

    for (const outcome of outcomes) {
      if (outcome.outcome === 'dismissed' || outcome.outcome === 'reduced') {
        contestsWon++;
        const saved = outcome.amount_saved || outcome.original_amount || TICKET_FINES.default;
        contestSavings += saved;
      }
    }
    moneySaved.contest_wins = contestSavings;

    // Calculate total
    moneySaved.total =
      moneySaved.street_cleaning_alerts +
      moneySaved.snow_route_alerts +
      moneySaved.winter_ban_alerts +
      moneySaved.tow_alerts +
      moneySaved.contest_wins;

    // Calculate averages
    const monthsAsMember = Math.max(1, daysAsMember / 30);
    const averageMonthlySavings = Math.round(moneySaved.total / monthsAsMember);

    // Close call stats
    const totalCloseCalls = closeCallsList.length;
    const closeCallsAvoided = closeCallsList.filter(c => c.was_avoided).length;
    const closeCallRate = totalCloseCalls > 0
      ? Math.round((closeCallsAvoided / totalCloseCalls) * 100)
      : 100;

    // Generate achievements
    const achievements = generateAchievements({
      daysAsMember,
      totalParkingEvents,
      moneySaved: moneySaved.total,
      closeCallsAvoided,
      contestsWon,
      contestsFiled: outcomes.length,
      riskyParkingPercentage,
    });

    // Generate personalized tips
    const tips = generateTips({
      riskyParkingPercentage,
      favoriteDay,
      totalParkingEvents,
      contestsWon,
      closeCallsAvoided,
    });

    const analytics: ParkingAnalytics = {
      member_since: memberSince,
      days_as_member: daysAsMember,

      total_close_calls: totalCloseCalls,
      close_calls_avoided: closeCallsAvoided,
      close_call_rate: closeCallRate,
      recent_close_calls: closeCallsList.slice(0, 10),  // Most recent 10

      estimated_money_saved: moneySaved,
      average_monthly_savings: averageMonthlySavings,

      total_parking_events: totalParkingEvents,
      total_hours_parked: Math.round(totalHoursParked),
      risky_parking_percentage: riskyParkingPercentage,
      favorite_day: favoriteDay,
      favorite_time: favoriteTime,

      contests_filed: outcomes.length,
      contests_won: contestsWon,
      contest_win_rate: outcomes.length > 0 ? Math.round((contestsWon / outcomes.length) * 100) : 0,
      contest_savings: contestSavings,

      achievements,
      tips,
    };

    return res.status(200).json({ success: true, analytics });

  } catch (error) {
    console.error('Error in parking-analytics:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

function generateAchievements(stats: {
  daysAsMember: number;
  totalParkingEvents: number;
  moneySaved: number;
  closeCallsAvoided: number;
  contestsWon: number;
  contestsFiled: number;
  riskyParkingPercentage: number;
}): Achievement[] {
  const achievements: Achievement[] = [];
  const now = new Date().toISOString();

  // Membership milestones
  if (stats.daysAsMember >= 30) {
    achievements.push({
      id: 'month_member',
      name: 'One Month Strong',
      description: 'Member for 30 days',
      icon: 'calendar',
      earned_at: now,
    });
  }
  if (stats.daysAsMember >= 365) {
    achievements.push({
      id: 'year_member',
      name: 'Yearly Veteran',
      description: 'Member for one full year',
      icon: 'award',
      earned_at: now,
    });
  }

  // Savings milestones
  if (stats.moneySaved >= 100) {
    achievements.push({
      id: 'saved_100',
      name: 'First Hundred',
      description: 'Saved $100 in potential tickets',
      icon: 'dollar-sign',
      earned_at: now,
    });
  }
  if (stats.moneySaved >= 500) {
    achievements.push({
      id: 'saved_500',
      name: 'Big Saver',
      description: 'Saved $500 in potential tickets',
      icon: 'trending-up',
      earned_at: now,
    });
  }
  if (stats.moneySaved >= 1000) {
    achievements.push({
      id: 'saved_1000',
      name: 'Grand Saver',
      description: 'Saved $1,000 in potential tickets!',
      icon: 'star',
      earned_at: now,
    });
  }

  // Close call achievements
  if (stats.closeCallsAvoided >= 1) {
    achievements.push({
      id: 'first_close_call',
      name: 'Narrow Escape',
      description: 'Avoided your first ticket',
      icon: 'shield',
      earned_at: now,
    });
  }
  if (stats.closeCallsAvoided >= 10) {
    achievements.push({
      id: 'ten_close_calls',
      name: 'Ticket Dodger',
      description: 'Avoided 10 potential tickets',
      icon: 'zap',
      earned_at: now,
    });
  }

  // Contest achievements
  if (stats.contestsWon >= 1) {
    achievements.push({
      id: 'first_win',
      name: 'First Victory',
      description: 'Won your first ticket contest',
      icon: 'trophy',
      earned_at: now,
    });
  }
  if (stats.contestsWon >= 5) {
    achievements.push({
      id: 'five_wins',
      name: 'Serial Winner',
      description: 'Won 5 ticket contests',
      icon: 'award',
      earned_at: now,
    });
  }

  // Safe parking achievement
  if (stats.riskyParkingPercentage < 20 && stats.totalParkingEvents >= 10) {
    achievements.push({
      id: 'safe_parker',
      name: 'Safe Parker',
      description: 'Less than 20% risky parking',
      icon: 'check-circle',
      earned_at: now,
    });
  }

  // Active user achievement
  if (stats.totalParkingEvents >= 50) {
    achievements.push({
      id: 'active_user',
      name: 'Road Warrior',
      description: 'Tracked 50+ parking sessions',
      icon: 'activity',
      earned_at: now,
    });
  }

  return achievements;
}

function generateTips(stats: {
  riskyParkingPercentage: number;
  favoriteDay: string | null;
  totalParkingEvents: number;
  contestsWon: number;
  closeCallsAvoided: number;
}): string[] {
  const tips: string[] = [];

  if (stats.riskyParkingPercentage > 50) {
    tips.push('Over half your parking is in restricted zones. Consider finding safer spots to avoid tickets.');
  }

  if (stats.favoriteDay === 'Monday' || stats.favoriteDay === 'Tuesday') {
    tips.push(`You park most on ${stats.favoriteDay}s - watch out for Monday/Tuesday street cleaning in many wards.`);
  }

  if (stats.totalParkingEvents < 10) {
    tips.push('Keep tracking your parking to build up your analytics and see patterns.');
  }

  if (stats.closeCallsAvoided > 0) {
    tips.push(`You've avoided ${stats.closeCallsAvoided} potential tickets - notifications are working!`);
  }

  if (stats.contestsWon === 0 && stats.totalParkingEvents > 20) {
    tips.push('Got a ticket? Use our AI-powered contest system - average win rate is 45%.');
  }

  // Always include a general tip
  tips.push('Enable push notifications to get real-time alerts before street cleaning and snow bans.');

  return tips.slice(0, 4);  // Max 4 tips
}
