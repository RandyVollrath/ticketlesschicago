/**
 * Parking Insights API
 *
 * Analyzes user's parking patterns and generates personalized insights.
 * Returns day-of-week patterns, time-of-day patterns, and AI-generated tips.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

interface DayOfWeekPattern {
  day: string; // 'Monday', 'Tuesday', etc.
  day_index: number; // 0-6
  count: number;
  percentage: number;
  avg_duration_minutes: number | null;
}

interface TimeOfDayPattern {
  period: string; // 'Morning', 'Afternoon', 'Evening', 'Night'
  start_hour: number;
  end_hour: number;
  count: number;
  percentage: number;
}

interface Insight {
  type: 'info' | 'warning' | 'tip';
  icon: string;
  title: string;
  description: string;
}

interface ParkingInsights {
  day_of_week_patterns: DayOfWeekPattern[];
  time_of_day_patterns: TimeOfDayPattern[];
  busiest_day: string | null;
  busiest_time: string | null;
  insights: Insight[];
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIME_PERIODS = [
  { period: 'Morning', start_hour: 6, end_hour: 12 },
  { period: 'Afternoon', start_hour: 12, end_hour: 17 },
  { period: 'Evening', start_hour: 17, end_hour: 21 },
  { period: 'Night', start_hour: 21, end_hour: 6 },
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify user authentication via Supabase JWT
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

    // Get parking history for pattern analysis
    const { data: history, error } = await supabaseAdmin
      .from('parking_location_history')
      .select('parked_at, cleared_at, on_winter_ban_street, on_snow_route, street_cleaning_date, permit_zone, address')
      .eq('user_id', user.id)
      .not('address', 'ilike', '%1019 W%Fullerton%')
      .order('parked_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Error fetching parking history for insights:', error);
      return res.status(500).json({ error: 'Failed to fetch parking data' });
    }

    if (!history || history.length === 0) {
      return res.status(200).json({
        success: true,
        insights: {
          day_of_week_patterns: [],
          time_of_day_patterns: [],
          busiest_day: null,
          busiest_time: null,
          insights: [{
            type: 'info',
            icon: 'car',
            title: 'Start Tracking',
            description: 'Park a few times to see your parking patterns and insights.',
          }],
        },
      });
    }

    // Analyze day-of-week patterns
    const dayCountsMap = new Map<number, { count: number; durations: number[] }>();
    for (let i = 0; i < 7; i++) {
      dayCountsMap.set(i, { count: 0, durations: [] });
    }

    // Analyze time-of-day patterns
    const timeCountsMap = new Map<string, number>();
    for (const period of TIME_PERIODS) {
      timeCountsMap.set(period.period, 0);
    }

    // Process each record
    for (const record of history) {
      const parkedDate = new Date(record.parked_at);
      const dayOfWeek = parkedDate.getDay();
      const hour = parkedDate.getHours();

      // Day of week
      const dayData = dayCountsMap.get(dayOfWeek)!;
      dayData.count++;

      // Duration for this day
      if (record.cleared_at) {
        const duration = (new Date(record.cleared_at).getTime() - parkedDate.getTime()) / (1000 * 60);
        if (duration >= 1 && duration <= 48 * 60) {
          dayData.durations.push(duration);
        }
      }

      // Time of day
      for (const period of TIME_PERIODS) {
        if (period.period === 'Night') {
          // Night spans midnight
          if (hour >= period.start_hour || hour < period.end_hour) {
            timeCountsMap.set(period.period, (timeCountsMap.get(period.period) || 0) + 1);
            break;
          }
        } else if (hour >= period.start_hour && hour < period.end_hour) {
          timeCountsMap.set(period.period, (timeCountsMap.get(period.period) || 0) + 1);
          break;
        }
      }
    }

    // Calculate patterns
    const totalEvents = history.length;

    const dayOfWeekPatterns: DayOfWeekPattern[] = DAYS_OF_WEEK.map((day, index) => {
      const data = dayCountsMap.get(index)!;
      return {
        day,
        day_index: index,
        count: data.count,
        percentage: Math.round((data.count / totalEvents) * 100),
        avg_duration_minutes: data.durations.length > 0
          ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
          : null,
      };
    });

    const timeOfDayPatterns: TimeOfDayPattern[] = TIME_PERIODS.map(period => ({
      period: period.period,
      start_hour: period.start_hour,
      end_hour: period.end_hour,
      count: timeCountsMap.get(period.period) || 0,
      percentage: Math.round(((timeCountsMap.get(period.period) || 0) / totalEvents) * 100),
    }));

    // Find busiest patterns
    const busiestDayPattern = dayOfWeekPatterns.reduce((max, p) => p.count > max.count ? p : max);
    const busiestTimePattern = timeOfDayPatterns.reduce((max, p) => p.count > max.count ? p : max);

    // Generate insights
    const insights: Insight[] = [];

    // Busiest day insight
    if (busiestDayPattern.count >= 3) {
      insights.push({
        type: 'info',
        icon: 'calendar',
        title: `${busiestDayPattern.day} Driver`,
        description: `You park most often on ${busiestDayPattern.day}s (${busiestDayPattern.percentage}% of your trips).`,
      });
    }

    // Time of day insight
    if (busiestTimePattern.count >= 3) {
      insights.push({
        type: 'info',
        icon: 'clock',
        title: `${busiestTimePattern.period} Parker`,
        description: `Most of your parking happens in the ${busiestTimePattern.period.toLowerCase()} (${busiestTimePattern.percentage}% of trips).`,
      });
    }

    // Duration insight
    const avgDurations = dayOfWeekPatterns
      .filter(p => p.avg_duration_minutes !== null)
      .map(p => p.avg_duration_minutes!);
    if (avgDurations.length > 0) {
      const overallAvg = Math.round(avgDurations.reduce((a, b) => a + b, 0) / avgDurations.length);
      if (overallAvg < 60) {
        insights.push({
          type: 'info',
          icon: 'zap',
          title: 'Quick Parker',
          description: `Your average parking duration is ${overallAvg} minutes. You're efficient!`,
        });
      } else if (overallAvg > 240) {
        insights.push({
          type: 'info',
          icon: 'coffee',
          title: 'Extended Stay',
          description: `You typically park for ${Math.round(overallAvg / 60 * 10) / 10} hours on average.`,
        });
      }
    }

    // Risk insights
    const restrictionCount = history.filter(h =>
      h.on_winter_ban_street || h.on_snow_route || h.street_cleaning_date || h.permit_zone
    ).length;
    const riskPercentage = Math.round((restrictionCount / totalEvents) * 100);

    if (riskPercentage > 50) {
      insights.push({
        type: 'warning',
        icon: 'alert-triangle',
        title: 'High-Risk Zones',
        description: `${riskPercentage}% of your parking is in restricted areas. Consider safer spots to avoid tickets.`,
      });
    } else if (riskPercentage < 20 && totalEvents > 5) {
      insights.push({
        type: 'tip',
        icon: 'shield',
        title: 'Safe Parker',
        description: `Great job! Only ${riskPercentage}% of your parking is in restricted zones.`,
      });
    }

    // Street cleaning insight
    const streetCleaningCount = history.filter(h => h.street_cleaning_date).length;
    if (streetCleaningCount > 5) {
      insights.push({
        type: 'tip',
        icon: 'droplet',
        title: 'Street Cleaning Alert',
        description: `You've parked on street cleaning routes ${streetCleaningCount} times. Make sure to check the schedule!`,
      });
    }

    // Winter ban insight
    const winterBanCount = history.filter(h => h.on_winter_ban_street).length;
    if (winterBanCount > 3) {
      insights.push({
        type: 'warning',
        icon: 'snowflake',
        title: 'Winter Ban Zones',
        description: `You've parked on winter overnight ban streets ${winterBanCount} times. These streets have 3am-7am parking bans Dec-Apr.`,
      });
    }

    // Weekend vs weekday insight
    const weekendCount = dayOfWeekPatterns
      .filter(p => p.day_index === 0 || p.day_index === 6)
      .reduce((sum, p) => sum + p.count, 0);
    const weekdayCount = totalEvents - weekendCount;
    if (weekendCount > weekdayCount * 1.5 && totalEvents > 10) {
      insights.push({
        type: 'info',
        icon: 'sun',
        title: 'Weekend Warrior',
        description: 'You drive more on weekends than weekdays.',
      });
    } else if (weekdayCount > weekendCount * 3 && totalEvents > 10) {
      insights.push({
        type: 'info',
        icon: 'briefcase',
        title: 'Weekday Commuter',
        description: 'Most of your parking is on weekdays. Consider transit options!',
      });
    }

    const parkingInsights: ParkingInsights = {
      day_of_week_patterns: dayOfWeekPatterns,
      time_of_day_patterns: timeOfDayPatterns,
      busiest_day: busiestDayPattern.count > 0 ? busiestDayPattern.day : null,
      busiest_time: busiestTimePattern.count > 0 ? busiestTimePattern.period : null,
      insights: insights.slice(0, 5), // Limit to 5 insights
    };

    return res.status(200).json({ success: true, insights: parkingInsights });

  } catch (error) {
    console.error('Error in parking-insights:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
