import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get FOIA statistics for ticket contesting
 *
 * Query parameters:
 * - violation_code: Get win rate for specific violation
 * - type: 'violation' | 'officer' | 'method' | 'ward' | 'dismissal_reasons' | 'overview'
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { violation_code, type = 'overview' } = req.query;

  try {
    if (type === 'violation' && violation_code) {
      // Get specific violation stats
      const { data, error } = await supabase
        .from('violation_win_rates')
        .select('*')
        .eq('violation_code', violation_code)
        .single();

      if (error) {
        return res.status(404).json({ error: 'Violation not found' });
      }

      return res.status(200).json(data);
    }

    if (type === 'violation') {
      // Get all violation stats (top violations)
      const { data, error } = await supabase
        .from('violation_win_rates')
        .select('*')
        .order('total_contests', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.status(200).json(data);
    }

    if (type === 'officer') {
      // Get officer stats
      const { data, error } = await supabase
        .from('officer_win_rates')
        .select('*')
        .order('total_cases', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.status(200).json(data);
    }

    if (type === 'method') {
      // Get contest method stats
      const { data, error } = await supabase
        .from('contest_method_win_rates')
        .select('*')
        .order('total_contests', { ascending: false });

      if (error) throw error;
      return res.status(200).json(data);
    }

    if (type === 'ward') {
      // Get ward stats
      const { data, error } = await supabase
        .from('ward_win_rates')
        .select('*')
        .order('ward', { ascending: true });

      if (error) throw error;
      return res.status(200).json(data);
    }

    if (type === 'dismissal_reasons') {
      // Get top dismissal reasons
      const { data, error } = await supabase
        .from('dismissal_reasons')
        .select('*')
        .order('count', { ascending: false })
        .limit(20);

      if (error) throw error;
      return res.status(200).json(data);
    }

    // Overview stats
    const { data: totalRecords } = await supabase
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true });

    const { data: winMethods } = await supabase
      .from('contest_method_win_rates')
      .select('*');

    const { data: topViolations } = await supabase
      .from('violation_win_rates')
      .select('*')
      .order('total_contests', { ascending: false })
      .limit(10);

    const { data: topReasons } = await supabase
      .from('dismissal_reasons')
      .select('*')
      .order('count', { ascending: false })
      .limit(5);

    return res.status(200).json({
      total_records: totalRecords,
      contest_methods: winMethods,
      top_violations: topViolations,
      top_dismissal_reasons: topReasons,
    });

  } catch (error) {
    console.error('Error fetching FOIA stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
