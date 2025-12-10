import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Recalculate win_rate_statistics from court_case_outcomes
 * Run this after importing new data or adding manual entries
 */
export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Recalculating win rate statistics...');

    // Get all outcomes
    const { data: outcomes, error: fetchError } = await supabaseAdmin
      .from('court_case_outcomes')
      .select('*');

    if (fetchError) throw fetchError;

    if (!outcomes || outcomes.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No outcomes to analyze',
        stats_updated: 0
      });
    }

    console.log(`📊 Analyzing ${outcomes.length} court case outcomes...`);

    // Group by violation code
    const byCode: Record<string, { dismissed: number; reduced: number; upheld: number; total: number }> = {};

    outcomes.forEach(outcome => {
      const code = outcome.violation_code;
      if (!code) return;

      if (!byCode[code]) {
        byCode[code] = { dismissed: 0, reduced: 0, upheld: 0, total: 0 };
      }

      byCode[code].total++;

      if (outcome.outcome === 'dismissed') {
        byCode[code].dismissed++;
      } else if (outcome.outcome === 'reduced') {
        byCode[code].reduced++;
      } else if (outcome.outcome === 'upheld') {
        byCode[code].upheld++;
      }
    });

    // Build statistics records
    const stats = Object.entries(byCode).map(([code, counts]) => {
      const winRate = Math.round(((counts.dismissed + counts.reduced) / counts.total) * 100);
      const dismissalRate = Math.round((counts.dismissed / counts.total) * 100);
      const reductionRate = Math.round((counts.reduced / counts.total) * 100);

      return {
        stat_type: 'violation_code',
        stat_key: code,
        total_cases: counts.total,
        dismissed_count: counts.dismissed,
        reduced_count: counts.reduced,
        upheld_count: counts.upheld,
        win_rate: winRate,
        dismissal_rate: dismissalRate,
        reduction_rate: reductionRate,
        sample_size_adequate: counts.total >= 30,
        last_calculated: new Date().toISOString()
      };
    });

    console.log(`📝 Updating statistics for ${stats.length} violation codes...`);

    // Upsert statistics
    const { error: upsertError } = await supabaseAdmin
      .from('win_rate_statistics')
      .upsert(stats, {
        onConflict: 'stat_type,stat_key'
      });

    if (upsertError) throw upsertError;

    console.log('✅ Win rate statistics updated successfully');

    return res.status(200).json({
      success: true,
      message: 'Win rate statistics recalculated',
      stats_updated: stats.length,
      total_outcomes_analyzed: outcomes.length,
      breakdown: stats.slice(0, 5).map(s => ({
        code: s.stat_key,
        win_rate: s.win_rate,
        cases: s.total_cases
      }))
    });

  } catch (error: any) {
    console.error('❌ Error recalculating win rates:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
});
