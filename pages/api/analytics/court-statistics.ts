import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get query parameters
    const { violationCode, ward, timeRange = '1year' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (timeRange) {
      case '1month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case '3months':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case '6months':
        startDate.setMonth(now.getMonth() - 6);
        break;
      case '1year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date('2020-01-01');
        break;
      default:
        startDate.setFullYear(now.getFullYear() - 1);
    }

    // Build base query
    let query = supabase
      .from('court_case_outcomes')
      .select('*')
      .gte('decision_date', startDate.toISOString().split('T')[0]);

    // Apply filters
    if (violationCode) {
      query = query.eq('violation_code', violationCode);
    }

    if (ward) {
      query = query.eq('ward', ward);
    }

    const { data: outcomes, error: fetchError } = await query;

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch court data: ' + fetchError.message });
    }

    // Calculate overall statistics
    const totalCases = outcomes?.length || 0;
    const dismissed = outcomes?.filter(o => o.outcome === 'dismissed').length || 0;
    const reduced = outcomes?.filter(o => o.outcome === 'reduced').length || 0;
    const upheld = outcomes?.filter(o => o.outcome === 'upheld').length || 0;
    const withdrawn = outcomes?.filter(o => o.outcome === 'withdrawn').length || 0;

    const winRate = totalCases > 0 ? ((dismissed + reduced) / totalCases * 100).toFixed(2) : 0;
    const dismissalRate = totalCases > 0 ? (dismissed / totalCases * 100).toFixed(2) : 0;
    const reductionRate = totalCases > 0 ? (reduced / totalCases * 100).toFixed(2) : 0;

    // Calculate average reduction percentage
    const reducedCases = outcomes?.filter(o => o.outcome === 'reduced' && o.reduction_percentage) || [];
    const avgReduction = reducedCases.length > 0
      ? (reducedCases.reduce((sum, c) => sum + (c.reduction_percentage || 0), 0) / reducedCases.length).toFixed(2)
      : 0;

    // Calculate average days to decision
    const casesWithDays = outcomes?.filter(o => o.days_to_decision) || [];
    const avgDays = casesWithDays.length > 0
      ? Math.round(casesWithDays.reduce((sum, c) => sum + (c.days_to_decision || 0), 0) / casesWithDays.length)
      : 0;

    // Get top violation codes
    const violationCounts: { [key: string]: number } = {};
    outcomes?.forEach(o => {
      if (o.violation_code) {
        violationCounts[o.violation_code] = (violationCounts[o.violation_code] || 0) + 1;
      }
    });
    const topViolations = Object.entries(violationCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    // Get win rates by violation code
    const violationWinRates: { [key: string]: { total: number; wins: number; winRate: number } } = {};
    outcomes?.forEach(o => {
      if (o.violation_code) {
        if (!violationWinRates[o.violation_code]) {
          violationWinRates[o.violation_code] = { total: 0, wins: 0, winRate: 0 };
        }
        violationWinRates[o.violation_code].total++;
        if (o.outcome === 'dismissed' || o.outcome === 'reduced') {
          violationWinRates[o.violation_code].wins++;
        }
      }
    });

    Object.keys(violationWinRates).forEach(code => {
      const stats = violationWinRates[code];
      stats.winRate = stats.total > 0 ? (stats.wins / stats.total * 100) : 0;
    });

    // Get monthly trends
    const monthlyData: { [key: string]: { total: number; dismissed: number; reduced: number; upheld: number } } = {};
    outcomes?.forEach(o => {
      if (o.decision_date) {
        const month = o.decision_date.substring(0, 7); // YYYY-MM
        if (!monthlyData[month]) {
          monthlyData[month] = { total: 0, dismissed: 0, reduced: 0, upheld: 0 };
        }
        monthlyData[month].total++;
        if (o.outcome === 'dismissed') monthlyData[month].dismissed++;
        if (o.outcome === 'reduced') monthlyData[month].reduced++;
        if (o.outcome === 'upheld') monthlyData[month].upheld++;
      }
    });

    const monthlyTrends = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stats]) => ({
        month,
        ...stats,
        winRate: stats.total > 0 ? ((stats.dismissed + stats.reduced) / stats.total * 100).toFixed(2) : 0
      }));

    // Get top contest grounds
    const groundCounts: { [key: string]: { total: number; wins: number } } = {};
    outcomes?.forEach(o => {
      if (o.contest_grounds) {
        o.contest_grounds.forEach((ground: string) => {
          if (!groundCounts[ground]) {
            groundCounts[ground] = { total: 0, wins: 0 };
          }
          groundCounts[ground].total++;
          if (o.outcome === 'dismissed' || o.outcome === 'reduced') {
            groundCounts[ground].wins++;
          }
        });
      }
    });

    const topGrounds = Object.entries(groundCounts)
      .map(([ground, stats]) => ({
        ground,
        total: stats.total,
        wins: stats.wins,
        winRate: stats.total > 0 ? (stats.wins / stats.total * 100).toFixed(2) : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Evidence impact analysis
    const evidenceImpact = {
      photos: { with: 0, without: 0, winWith: 0, winWithout: 0 },
      witnesses: { with: 0, without: 0, winWith: 0, winWithout: 0 },
      documentation: { with: 0, without: 0, winWith: 0, winWithout: 0 }
    };

    outcomes?.forEach(o => {
      const hasPhotos = o.evidence_submitted?.photos === true;
      const hasWitnesses = o.evidence_submitted?.witnesses === true;
      const hasDocs = o.evidence_submitted?.documentation === true;
      const won = o.outcome === 'dismissed' || o.outcome === 'reduced';

      if (hasPhotos) {
        evidenceImpact.photos.with++;
        if (won) evidenceImpact.photos.winWith++;
      } else {
        evidenceImpact.photos.without++;
        if (won) evidenceImpact.photos.winWithout++;
      }

      if (hasWitnesses) {
        evidenceImpact.witnesses.with++;
        if (won) evidenceImpact.witnesses.winWith++;
      } else {
        evidenceImpact.witnesses.without++;
        if (won) evidenceImpact.witnesses.winWithout++;
      }

      if (hasDocs) {
        evidenceImpact.documentation.with++;
        if (won) evidenceImpact.documentation.winWith++;
      } else {
        evidenceImpact.documentation.without++;
        if (won) evidenceImpact.documentation.winWithout++;
      }
    });

    // Calculate win rates for evidence
    const evidenceAnalysis = {
      photos: {
        withRate: evidenceImpact.photos.with > 0 ? (evidenceImpact.photos.winWith / evidenceImpact.photos.with * 100).toFixed(2) : 0,
        withoutRate: evidenceImpact.photos.without > 0 ? (evidenceImpact.photos.winWithout / evidenceImpact.photos.without * 100).toFixed(2) : 0,
        impact: 0
      },
      witnesses: {
        withRate: evidenceImpact.witnesses.with > 0 ? (evidenceImpact.witnesses.winWith / evidenceImpact.witnesses.with * 100).toFixed(2) : 0,
        withoutRate: evidenceImpact.witnesses.without > 0 ? (evidenceImpact.witnesses.winWithout / evidenceImpact.witnesses.without * 100).toFixed(2) : 0,
        impact: 0
      },
      documentation: {
        withRate: evidenceImpact.documentation.with > 0 ? (evidenceImpact.documentation.winWith / evidenceImpact.documentation.with * 100).toFixed(2) : 0,
        withoutRate: evidenceImpact.documentation.without > 0 ? (evidenceImpact.documentation.winWithout / evidenceImpact.documentation.without * 100).toFixed(2) : 0,
        impact: 0
      }
    };

    evidenceAnalysis.photos.impact = parseFloat(evidenceAnalysis.photos.withRate) - parseFloat(evidenceAnalysis.photos.withoutRate);
    evidenceAnalysis.witnesses.impact = parseFloat(evidenceAnalysis.witnesses.withRate) - parseFloat(evidenceAnalysis.witnesses.withoutRate);
    evidenceAnalysis.documentation.impact = parseFloat(evidenceAnalysis.documentation.withRate) - parseFloat(evidenceAnalysis.documentation.withoutRate);

    res.status(200).json({
      success: true,
      timeRange,
      filters: { violationCode, ward },
      overall: {
        totalCases,
        dismissed,
        reduced,
        upheld,
        withdrawn,
        winRate: parseFloat(winRate as string),
        dismissalRate: parseFloat(dismissalRate as string),
        reductionRate: parseFloat(reductionRate as string),
        avgReduction: parseFloat(avgReduction as string),
        avgDaysToDecision: avgDays
      },
      topViolations,
      violationWinRates,
      monthlyTrends,
      topGrounds,
      evidenceAnalysis
    });

  } catch (error: any) {
    console.error('Court statistics error:', error);
    res.status(500).json({ error: error.message });
  }
}
