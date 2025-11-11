import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get FOIA statistics for a specific violation - computed on the fly
 * No materialized views needed
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
    // Get all records for this violation code
    const { data: records, error } = await supabase
      .from('contested_tickets_foia')
      .select('*')
      .eq('violation_code', violation_code);

    if (error) throw error;

    if (!records || records.length === 0) {
      return res.status(200).json({
        has_data: false,
        message: 'No historical contest data available for this violation code',
        violation_code,
      });
    }

    // Compute statistics
    const total_contests = records.length;
    const wins = records.filter(r => r.disposition === 'Not Liable').length;
    const losses = records.filter(r => r.disposition === 'Liable').length;
    const denied = records.filter(r => r.disposition === 'Denied').length;
    const other = records.filter(r => ['Withdrawn', 'Stricken'].includes(r.disposition)).length;

    const win_rate_percent = (wins / total_contests) * 100;
    const win_rate_decided_percent = losses + wins > 0 ? (wins / (wins + losses)) * 100 : 0;

    // Get violation description from first record
    const violation_description = records[0].violation_description;

    // Count dismissal reasons
    const dismissalReasons: Record<string, number> = {};
    records
      .filter(r => r.disposition === 'Not Liable' && r.reason)
      .forEach(r => {
        dismissalReasons[r.reason] = (dismissalReasons[r.reason] || 0) + 1;
      });

    const top_dismissal_reasons = Object.entries(dismissalReasons)
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / wins) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Contest method breakdown
    const methodStats: Record<string, { total: number; wins: number }> = {};
    records.forEach(r => {
      const method = r.contest_type || 'Unknown';
      if (!methodStats[method]) {
        methodStats[method] = { total: 0, wins: 0 };
      }
      methodStats[method].total++;
      if (r.disposition === 'Not Liable') {
        methodStats[method].wins++;
      }
    });

    const contest_methods = Object.entries(methodStats)
      .map(([method, stats]) => ({
        method,
        total: stats.total,
        wins: stats.wins,
        win_rate: (stats.wins / stats.total) * 100,
      }))
      .sort((a, b) => b.win_rate - a.win_rate);

    const best_method = contest_methods[0] || null;

    // Recommendation
    let recommendation = '';
    let recommendation_level: 'strong' | 'moderate' | 'weak' = 'weak';

    if (win_rate_percent >= 60) {
      recommendation = 'STRONGLY RECOMMEND CONTESTING - Historical data shows high dismissal rate';
      recommendation_level = 'strong';
    } else if (win_rate_percent >= 40) {
      recommendation = 'RECOMMEND CONTESTING - Good chance based on historical outcomes';
      recommendation_level = 'moderate';
    } else {
      recommendation = 'CONSIDER CAREFULLY - Lower historical win rate, ensure you have strong evidence';
      recommendation_level = 'weak';
    }

    return res.status(200).json({
      has_data: true,
      violation_code,
      violation_description,
      total_contests,
      wins,
      losses,
      denied,
      other,
      win_rate_percent: Math.round(win_rate_percent * 10) / 10,
      win_rate_decided_percent: Math.round(win_rate_decided_percent * 10) / 10,
      top_dismissal_reasons,
      contest_methods,
      best_method,
      recommendation,
      recommendation_level,
      data_source: 'Chicago DOAH FOIA - 2019 to present',
      total_records_analyzed: total_contests,
    });

  } catch (error) {
    console.error('Error fetching violation stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
