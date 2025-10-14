import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getOrdinanceByCode } from '../../../lib/chicago-ordinances';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Enhanced Win Probability Calculator
 *
 * Uses historical court data when available, falls back to ordinance database
 *
 * Checks:
 * - Overall win rate for violation code from court records
 * - Win rate by ward/location
 * - Win rate by specific contest grounds
 * - Win rate by evidence type
 * - Seasonal trends
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      violationCode,
      contestGrounds,
      hasPhotos,
      hasWitnesses,
      hasDocumentation,
      daysSinceTicket,
      ward,
      ticketMonth
    } = req.body;

    // Start with base probability from ordinance database
    const ordinance = violationCode ? getOrdinanceByCode(violationCode) : null;
    let baseProbability = ordinance?.winProbability || 30; // Default 30% if no data
    let dataSource = 'ordinance_database';

    // Try to get historical court data for this violation
    if (violationCode) {
      const { data: winRateData } = await supabase
        .from('win_rate_statistics')
        .select('*')
        .eq('stat_type', 'violation_code')
        .eq('stat_key', violationCode)
        .single();

      if (winRateData && winRateData.sample_size_adequate) {
        baseProbability = winRateData.win_rate;
        dataSource = 'court_records';
      }
    }

    // Start with base probability
    let probability = baseProbability;
    const modifiers: { [key: string]: number } = {};

    // Evidence modifiers
    if (hasPhotos) {
      modifiers.photos = 10;
      probability += 10;
    }

    if (hasWitnesses) {
      modifiers.witnesses = 8;
      probability += 8;
    }

    if (hasDocumentation) {
      modifiers.documentation = 7;
      probability += 7;
    }

    // Contest grounds modifiers
    const numGrounds = contestGrounds?.length || 0;
    if (numGrounds === 0) {
      modifiers.no_grounds = -15;
      probability -= 15;
    } else if (numGrounds >= 3) {
      modifiers.multiple_grounds = 5;
      probability += 5;
    }

    // Check for strong grounds from court data
    let strongGroundBoost = 0;
    if (contestGrounds && contestGrounds.length > 0) {
      for (const ground of contestGrounds) {
        // Look up this specific ground's success rate
        const { data: groundData } = await supabase
          .from('win_rate_statistics')
          .select('win_rate, sample_size_adequate')
          .eq('stat_type', 'contest_ground')
          .eq('stat_key', ground)
          .single();

        if (groundData && groundData.sample_size_adequate && groundData.win_rate > 60) {
          strongGroundBoost = Math.max(strongGroundBoost, 12);
        }
      }
    }

    if (strongGroundBoost > 0) {
      modifiers.strong_ground = strongGroundBoost;
      probability += strongGroundBoost;
    }

    // Time factor
    if (daysSinceTicket !== undefined) {
      if (daysSinceTicket <= 7) {
        modifiers.recent_filing = 3;
        probability += 3;
      } else if (daysSinceTicket > 60) {
        modifiers.delayed_filing = -5;
        probability -= 5;
      }
    }

    // Ward-specific modifier (if court data available)
    if (ward && violationCode) {
      const { data: wardData } = await supabase
        .from('court_case_outcomes')
        .select('outcome')
        .eq('violation_code', violationCode)
        .eq('ward', ward);

      if (wardData && wardData.length >= 10) {
        const wardWins = wardData.filter(c =>
          c.outcome === 'dismissed' || c.outcome === 'reduced'
        ).length;
        const wardWinRate = (wardWins / wardData.length) * 100;
        const wardModifier = Math.round(wardWinRate - baseProbability);

        if (Math.abs(wardModifier) >= 5) {
          modifiers.ward_specific = wardModifier;
          probability += wardModifier;
        }
      }
    }

    // Seasonal modifier (if month provided and data available)
    if (ticketMonth && violationCode) {
      const { data: monthData } = await supabase
        .from('win_rate_statistics')
        .select('win_rate, sample_size_adequate')
        .eq('stat_type', 'month')
        .eq('stat_key', `${violationCode}:${ticketMonth}`)
        .single();

      if (monthData && monthData.sample_size_adequate) {
        const seasonalModifier = Math.round(monthData.win_rate - baseProbability);
        if (Math.abs(seasonalModifier) >= 3) {
          modifiers.seasonal = seasonalModifier;
          probability += seasonalModifier;
        }
      }
    }

    // Cap probability between 5% and 95%
    probability = Math.max(5, Math.min(95, probability));

    // Generate recommendation
    let recommendation = '';
    let recommendationColor = '';
    let confidence = 'high';

    if (dataSource === 'court_records') {
      confidence = 'very_high';
    } else if (ordinance) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    if (probability >= 70) {
      recommendation = 'Strong Case - High likelihood of success. Contest is recommended.';
      recommendationColor = '#10b981';
    } else if (probability >= 50) {
      recommendation = 'Moderate Case - Reasonable chance of success. Contest may be worthwhile.';
      recommendationColor = '#f59e0b';
    } else if (probability >= 30) {
      recommendation = 'Weak Case - Lower probability of success. Consider if ticket amount justifies effort.';
      recommendationColor = '#ef4444';
    } else {
      recommendation = 'Very Weak Case - Low probability of success. May not be worth contesting.';
      recommendationColor = '#dc2626';
    }

    // Generate suggestions
    const suggestions = [];

    if (!hasPhotos) {
      suggestions.push('Add photographic evidence of the location, signage, and circumstances');
    }

    if (!hasWitnesses && probability < 60) {
      suggestions.push('Gather witness statements if available');
    }

    if (!hasDocumentation) {
      suggestions.push('Obtain any relevant official documentation (permits, receipts, police reports)');
    }

    if (numGrounds < 2) {
      suggestions.push('Consider additional contest grounds that may apply');
    }

    if (daysSinceTicket && daysSinceTicket > 30) {
      suggestions.push('Contest as soon as possible - fresher cases have better outcomes');
    }

    // Get sample size for confidence
    let sampleSize = 0;
    if (dataSource === 'court_records' && violationCode) {
      const { count } = await supabase
        .from('court_case_outcomes')
        .select('id', { count: 'exact', head: true })
        .eq('violation_code', violationCode);

      sampleSize = count || 0;
    }

    res.status(200).json({
      success: true,
      probability: Math.round(probability),
      baseProbability: Math.round(baseProbability),
      recommendation,
      recommendationColor,
      confidence,
      dataSource,
      sampleSize,
      suggestions,
      modifiers,
      ordinanceInfo: ordinance ? {
        code: ordinance.code,
        title: ordinance.title,
        category: ordinance.category
      } : null
    });

  } catch (error: any) {
    console.error('Enhanced win probability error:', error);
    res.status(500).json({ error: error.message });
  }
}
