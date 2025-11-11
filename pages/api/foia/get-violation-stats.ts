import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get FOIA-based statistics for a specific violation code
 * This provides real-world contest outcomes from 1.2M DOAH records
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { violation_code } = req.query;

  if (!violation_code || typeof violation_code !== 'string') {
    return res.status(400).json({ error: 'violation_code is required' });
  }

  try {
    // Get violation win rate stats
    const { data: violationStats, error: violationError } = await supabase
      .from('violation_win_rates')
      .select('*')
      .eq('violation_code', violation_code)
      .single();

    if (violationError && violationError.code !== 'PGRST116') {
      throw violationError;
    }

    if (!violationStats) {
      // No FOIA data for this violation code
      return res.status(200).json({
        has_data: false,
        message: 'No historical contest data available for this violation code',
        violation_code,
      });
    }

    // Get top dismissal reasons for this specific violation
    const { data: dismissalReasons } = await supabase
      .from('contested_tickets_foia')
      .select('reason')
      .eq('violation_code', violation_code)
      .eq('disposition', 'Not Liable')
      .not('reason', 'is', null);

    // Count occurrences of each reason
    const reasonCounts: Record<string, number> = {};
    dismissalReasons?.forEach(({ reason }) => {
      if (reason) {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
    });

    const topReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / violationStats.wins) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Get contest method breakdown for this violation
    const { data: methodBreakdown } = await supabase
      .from('contested_tickets_foia')
      .select('contest_type, disposition')
      .eq('violation_code', violation_code);

    const methodStats: Record<string, { total: number; wins: number }> = {};
    methodBreakdown?.forEach(({ contest_type, disposition }) => {
      if (!methodStats[contest_type]) {
        methodStats[contest_type] = { total: 0, wins: 0 };
      }
      methodStats[contest_type].total++;
      if (disposition === 'Not Liable') {
        methodStats[contest_type].wins++;
      }
    });

    const contestMethods = Object.entries(methodStats)
      .map(([method, stats]) => ({
        method,
        total: stats.total,
        wins: stats.wins,
        win_rate: (stats.wins / stats.total) * 100,
      }))
      .sort((a, b) => b.win_rate - a.win_rate);

    // Recommendation logic based on real data
    let recommendation = '';
    let recommendationLevel: 'strong' | 'moderate' | 'weak' = 'weak';

    if (violationStats.win_rate_percent >= 60) {
      recommendation = 'STRONGLY RECOMMEND CONTESTING - Historical data shows high dismissal rate';
      recommendationLevel = 'strong';
    } else if (violationStats.win_rate_percent >= 40) {
      recommendation = 'RECOMMEND CONTESTING - Good chance based on historical outcomes';
      recommendationLevel = 'moderate';
    } else {
      recommendation = 'CONSIDER CAREFULLY - Lower historical win rate, ensure you have strong evidence';
      recommendationLevel = 'weak';
    }

    // Best contest method
    const bestMethod = contestMethods.length > 0
      ? contestMethods[0]
      : null;

    return res.status(200).json({
      has_data: true,
      violation_code: violationStats.violation_code,
      violation_description: violationStats.violation_description,

      // Win rate statistics
      total_contests: violationStats.total_contests,
      wins: violationStats.wins,
      losses: violationStats.losses,
      denied: violationStats.denied,
      win_rate_percent: violationStats.win_rate_percent,
      win_rate_decided_percent: violationStats.win_rate_decided_percent,

      // Top dismissal reasons
      top_dismissal_reasons: topReasons,

      // Contest method analysis
      contest_methods: contestMethods,
      best_method: bestMethod,

      // Recommendation
      recommendation,
      recommendation_level: recommendationLevel,

      // Data source
      data_source: 'Chicago DOAH FOIA - 2019 to present',
      last_updated: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error fetching violation stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
