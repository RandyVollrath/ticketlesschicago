// @ts-nocheck
/**
 * Outcome Learning Loop
 *
 * Tracks contest outcomes and continuously improves
 * predictions and recommendations based on real results.
 */

import { createClient } from '@supabase/supabase-js';
import {
  ContestOutcome,
  ContestOutcomeType,
  HearingType,
  LearningStats,
} from './types';

// Minimum cases for statistical significance
const MIN_CASES_FOR_TREND = 5;
const TREND_THRESHOLD = 0.05; // 5% change threshold for trend detection

/**
 * Record a contest outcome for learning
 */
export async function recordContestOutcome(
  supabase: ReturnType<typeof createClient>,
  outcome: Omit<ContestOutcome, 'id' | 'created_at'>
): Promise<ContestOutcome | null> {
  // Calculate amount saved
  const amountSaved = outcome.original_amount && outcome.final_amount
    ? Math.max(0, outcome.original_amount - outcome.final_amount)
    : undefined;

  const { data, error } = await supabase
    .from('contest_outcomes')
    .insert({
      ticket_id: outcome.ticket_id,
      letter_id: outcome.letter_id,
      user_id: outcome.user_id,
      outcome: outcome.outcome,
      outcome_date: outcome.outcome_date,
      original_amount: outcome.original_amount,
      final_amount: outcome.final_amount,
      amount_saved: amountSaved,
      violation_type: outcome.violation_type,
      violation_code: outcome.violation_code,
      ward: outcome.ward,
      primary_defense: outcome.primary_defense,
      secondary_defenses: outcome.secondary_defenses,
      weather_defense_used: outcome.weather_defense_used,
      evidence_types: outcome.evidence_types,
      evidence_count: outcome.evidence_count,
      hearing_type: outcome.hearing_type,
      hearing_officer_id: outcome.hearing_officer_id,
      hearing_date: outcome.hearing_date,
      letter_quality_score: outcome.letter_quality_score,
      predicted_win_probability: outcome.predicted_win_probability,
      actual_outcome_matches_prediction: outcome.actual_outcome_matches_prediction,
      user_satisfaction: outcome.user_satisfaction,
      user_feedback: outcome.user_feedback,
      feature_vector: outcome.feature_vector,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error recording contest outcome:', error);
    return null;
  }

  // Note: learning_stats and user_contest_metrics are updated automatically
  // by database triggers defined in the migration

  return mapToContestOutcome(data);
}

/**
 * Get outcome by ticket ID
 */
export async function getOutcomeByTicketId(
  supabase: ReturnType<typeof createClient>,
  ticketId: string
): Promise<ContestOutcome | null> {
  const { data, error } = await supabase
    .from('contest_outcomes')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapToContestOutcome(data);
}

/**
 * Get all outcomes for a user
 */
export async function getUserOutcomes(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    outcomeFilter?: ContestOutcomeType[];
  }
): Promise<ContestOutcome[]> {
  let query = supabase
    .from('contest_outcomes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.outcomeFilter && options.outcomeFilter.length > 0) {
    query = query.in('outcome', options.outcomeFilter);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map(mapToContestOutcome);
}

/**
 * Get learning stats for a category
 */
export async function getLearningStats(
  supabase: ReturnType<typeof createClient>,
  category: 'violation' | 'defense' | 'ward' | 'officer' | 'evidence',
  subcategory?: string
): Promise<LearningStats[]> {
  let query = supabase
    .from('learning_stats')
    .select('*')
    .eq('category', category);

  if (subcategory) {
    query = query.eq('subcategory', subcategory);
  }

  query = query.order('total_cases', { ascending: false });

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map(mapToLearningStats);
}

/**
 * Get top performing defenses for a violation type
 */
export async function getTopDefensesForViolation(
  supabase: ReturnType<typeof createClient>,
  violationType: string,
  limit: number = 5
): Promise<Array<{ defense: string; win_rate: number; cases: number }>> {
  // Query outcomes for this violation type
  const { data, error } = await supabase
    .from('contest_outcomes')
    .select('primary_defense, outcome')
    .eq('violation_type', violationType)
    .in('outcome', ['dismissed', 'reduced']);

  if (error || !data) {
    return [];
  }

  // Aggregate by defense
  const defenseStats: Record<string, { wins: number; total: number }> = {};

  // Also get total cases per defense
  const { data: allOutcomes } = await supabase
    .from('contest_outcomes')
    .select('primary_defense, outcome')
    .eq('violation_type', violationType);

  if (allOutcomes) {
    for (const outcome of allOutcomes) {
      if (!outcome.primary_defense) continue;

      if (!defenseStats[outcome.primary_defense]) {
        defenseStats[outcome.primary_defense] = { wins: 0, total: 0 };
      }
      defenseStats[outcome.primary_defense].total += 1;

      if (outcome.outcome === 'dismissed' || outcome.outcome === 'reduced') {
        defenseStats[outcome.primary_defense].wins += 1;
      }
    }
  }

  // Convert to array and sort by win rate
  return Object.entries(defenseStats)
    .filter(([_, stats]) => stats.total >= MIN_CASES_FOR_TREND)
    .map(([defense, stats]) => ({
      defense,
      win_rate: stats.wins / stats.total,
      cases: stats.total,
    }))
    .sort((a, b) => b.win_rate - a.win_rate)
    .slice(0, limit);
}

/**
 * Get win rate trends over time
 */
export async function getWinRateTrends(
  supabase: ReturnType<typeof createClient>,
  options?: {
    category?: 'violation' | 'defense' | 'ward';
    subcategory?: string;
    days?: number;
  }
): Promise<Array<{ date: string; win_rate: number; cases: number }>> {
  const days = options?.days || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let query = supabase
    .from('contest_outcomes')
    .select('outcome_date, outcome, violation_type, primary_defense, ward')
    .gte('outcome_date', startDate.toISOString())
    .not('outcome_date', 'is', null);

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Filter by category if specified
  let filteredData = data;
  if (options?.category && options?.subcategory) {
    switch (options.category) {
      case 'violation':
        filteredData = data.filter(d => d.violation_type === options.subcategory);
        break;
      case 'defense':
        filteredData = data.filter(d => d.primary_defense === options.subcategory);
        break;
      case 'ward':
        filteredData = data.filter(d => d.ward?.toString() === options.subcategory);
        break;
    }
  }

  // Group by date
  const dailyStats: Record<string, { wins: number; total: number }> = {};

  for (const outcome of filteredData) {
    if (!outcome.outcome_date) continue;

    const date = outcome.outcome_date.split('T')[0];
    if (!dailyStats[date]) {
      dailyStats[date] = { wins: 0, total: 0 };
    }
    dailyStats[date].total += 1;

    if (outcome.outcome === 'dismissed' || outcome.outcome === 'reduced') {
      dailyStats[date].wins += 1;
    }
  }

  // Convert to sorted array
  return Object.entries(dailyStats)
    .map(([date, stats]) => ({
      date,
      win_rate: stats.total > 0 ? stats.wins / stats.total : 0,
      cases: stats.total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Analyze which evidence types are most effective
 */
export async function analyzeEvidenceEffectiveness(
  supabase: ReturnType<typeof createClient>,
  violationType?: string
): Promise<Array<{ evidence_type: string; win_rate: number; cases: number; impact_score: number }>> {
  let query = supabase
    .from('contest_outcomes')
    .select('evidence_types, outcome');

  if (violationType) {
    query = query.eq('violation_type', violationType);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  // Aggregate by evidence type
  const evidenceStats: Record<string, { wins: number; total: number }> = {};

  // Calculate baseline win rate (no specific evidence)
  let baselineWins = 0;
  let baselineTotal = 0;

  for (const outcome of data) {
    const won = outcome.outcome === 'dismissed' || outcome.outcome === 'reduced';
    baselineTotal += 1;
    if (won) baselineWins += 1;

    if (outcome.evidence_types && outcome.evidence_types.length > 0) {
      for (const evidenceType of outcome.evidence_types) {
        if (!evidenceStats[evidenceType]) {
          evidenceStats[evidenceType] = { wins: 0, total: 0 };
        }
        evidenceStats[evidenceType].total += 1;
        if (won) {
          evidenceStats[evidenceType].wins += 1;
        }
      }
    }
  }

  const baselineWinRate = baselineTotal > 0 ? baselineWins / baselineTotal : 0;

  // Convert to array with impact scores
  return Object.entries(evidenceStats)
    .filter(([_, stats]) => stats.total >= MIN_CASES_FOR_TREND)
    .map(([evidenceType, stats]) => {
      const winRate = stats.wins / stats.total;
      // Impact score: how much this evidence type improves win rate vs baseline
      const impactScore = winRate - baselineWinRate;

      return {
        evidence_type: evidenceType,
        win_rate: winRate,
        cases: stats.total,
        impact_score: impactScore,
      };
    })
    .sort((a, b) => b.impact_score - a.impact_score);
}

/**
 * Calculate predicted win probability based on learned patterns
 */
export async function calculatePredictedWinProbability(
  supabase: ReturnType<typeof createClient>,
  caseDetails: {
    violation_type: string;
    primary_defense: string;
    ward?: number;
    evidence_types: string[];
    hearing_type?: HearingType;
    hearing_officer_id?: string;
    letter_quality_score?: number;
  }
): Promise<{ probability: number; confidence: number; factors: Array<{ factor: string; impact: number }> }> {
  const factors: Array<{ factor: string; impact: number }> = [];
  let baseProbability = 0.45; // Default baseline
  let totalWeight = 0;
  let weightedSum = 0;

  // Factor 1: Violation type base rate
  const violationStats = await getLearningStats(supabase, 'violation', caseDetails.violation_type);
  if (violationStats.length > 0 && violationStats[0].total_cases >= MIN_CASES_FOR_TREND) {
    const impact = violationStats[0].current_win_rate - baseProbability;
    factors.push({ factor: `${caseDetails.violation_type} base rate`, impact });
    weightedSum += violationStats[0].current_win_rate * 2;
    totalWeight += 2;
  }

  // Factor 2: Defense type effectiveness
  const defenseStats = await getLearningStats(supabase, 'defense', caseDetails.primary_defense);
  if (defenseStats.length > 0 && defenseStats[0].total_cases >= MIN_CASES_FOR_TREND) {
    const impact = defenseStats[0].current_win_rate - baseProbability;
    factors.push({ factor: `${caseDetails.primary_defense} defense`, impact });
    weightedSum += defenseStats[0].current_win_rate * 1.5;
    totalWeight += 1.5;
  }

  // Factor 3: Ward performance
  if (caseDetails.ward) {
    const wardStats = await getLearningStats(supabase, 'ward', caseDetails.ward.toString());
    if (wardStats.length > 0 && wardStats[0].total_cases >= MIN_CASES_FOR_TREND) {
      const impact = wardStats[0].current_win_rate - baseProbability;
      factors.push({ factor: `Ward ${caseDetails.ward}`, impact });
      weightedSum += wardStats[0].current_win_rate;
      totalWeight += 1;
    }
  }

  // Factor 4: Evidence types
  for (const evidenceType of caseDetails.evidence_types) {
    const evidenceStats = await getLearningStats(supabase, 'evidence', evidenceType);
    if (evidenceStats.length > 0 && evidenceStats[0].total_cases >= MIN_CASES_FOR_TREND) {
      const impact = evidenceStats[0].current_win_rate - baseProbability;
      factors.push({ factor: `${evidenceType} evidence`, impact });
      weightedSum += evidenceStats[0].current_win_rate * 0.5;
      totalWeight += 0.5;
    }
  }

  // Factor 5: Hearing officer
  if (caseDetails.hearing_officer_id) {
    const officerStats = await getLearningStats(supabase, 'officer', caseDetails.hearing_officer_id);
    if (officerStats.length > 0 && officerStats[0].total_cases >= MIN_CASES_FOR_TREND) {
      const impact = officerStats[0].current_win_rate - baseProbability;
      factors.push({ factor: 'Hearing officer history', impact });
      weightedSum += officerStats[0].current_win_rate * 1.5;
      totalWeight += 1.5;
    }
  }

  // Factor 6: Letter quality (if available)
  if (caseDetails.letter_quality_score !== undefined) {
    // Higher quality letters correlate with better outcomes
    const qualityImpact = (caseDetails.letter_quality_score - 50) / 100 * 0.2;
    factors.push({ factor: 'Letter quality', impact: qualityImpact });
    // Letter quality contributes to final probability
    weightedSum += (baseProbability + qualityImpact);
    totalWeight += 0.5;
  }

  // Calculate final probability
  let probability = totalWeight > 0 ? weightedSum / totalWeight : baseProbability;

  // Clamp to valid range
  probability = Math.max(0.05, Math.min(0.95, probability));

  // Calculate confidence based on data availability
  const dataPoints = factors.length;
  const confidence = Math.min(0.95, 0.3 + (dataPoints * 0.12));

  return {
    probability,
    confidence,
    factors,
  };
}

/**
 * Get similar cases and their outcomes
 */
export async function getSimilarCases(
  supabase: ReturnType<typeof createClient>,
  caseDetails: {
    violation_type: string;
    primary_defense?: string;
    ward?: number;
  },
  limit: number = 10
): Promise<ContestOutcome[]> {
  let query = supabase
    .from('contest_outcomes')
    .select('*')
    .eq('violation_type', caseDetails.violation_type)
    .not('outcome', 'is', null)
    .order('outcome_date', { ascending: false });

  // Prioritize cases with same defense
  if (caseDetails.primary_defense) {
    query = query.eq('primary_defense', caseDetails.primary_defense);
  }

  // Filter by ward if specified
  if (caseDetails.ward) {
    query = query.eq('ward', caseDetails.ward);
  }

  query = query.limit(limit);

  const { data, error } = await query;

  if (error || !data || data.length === 0) {
    // If no exact matches, try just violation type
    const { data: fallbackData } = await supabase
      .from('contest_outcomes')
      .select('*')
      .eq('violation_type', caseDetails.violation_type)
      .not('outcome', 'is', null)
      .order('outcome_date', { ascending: false })
      .limit(limit);

    if (!fallbackData) return [];
    return fallbackData.map(mapToContestOutcome);
  }

  return data.map(mapToContestOutcome);
}

/**
 * Update outcome with user feedback
 */
export async function recordUserFeedback(
  supabase: ReturnType<typeof createClient>,
  outcomeId: string,
  satisfaction: number,
  feedback?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('contest_outcomes')
    .update({
      user_satisfaction: satisfaction,
      user_feedback: feedback,
    })
    .eq('id', outcomeId);

  return !error;
}

/**
 * Get aggregate statistics for the learning system
 */
export async function getOverallLearningStats(
  supabase: ReturnType<typeof createClient>
): Promise<{
  total_outcomes: number;
  total_wins: number;
  overall_win_rate: number;
  total_savings: number;
  avg_savings_per_win: number;
  prediction_accuracy: number;
}> {
  const { data, error } = await supabase
    .from('contest_outcomes')
    .select('outcome, amount_saved, predicted_win_probability, actual_outcome_matches_prediction');

  if (error || !data) {
    return {
      total_outcomes: 0,
      total_wins: 0,
      overall_win_rate: 0,
      total_savings: 0,
      avg_savings_per_win: 0,
      prediction_accuracy: 0,
    };
  }

  let totalWins = 0;
  let totalSavings = 0;
  let correctPredictions = 0;
  let predictionsWithData = 0;

  for (const outcome of data) {
    if (outcome.outcome === 'dismissed' || outcome.outcome === 'reduced') {
      totalWins += 1;
      if (outcome.amount_saved) {
        totalSavings += outcome.amount_saved;
      }
    }

    if (outcome.actual_outcome_matches_prediction !== null) {
      predictionsWithData += 1;
      if (outcome.actual_outcome_matches_prediction) {
        correctPredictions += 1;
      }
    }
  }

  return {
    total_outcomes: data.length,
    total_wins: totalWins,
    overall_win_rate: data.length > 0 ? totalWins / data.length : 0,
    total_savings: totalSavings,
    avg_savings_per_win: totalWins > 0 ? totalSavings / totalWins : 0,
    prediction_accuracy: predictionsWithData > 0 ? correctPredictions / predictionsWithData : 0,
  };
}

/**
 * Map database row to ContestOutcome
 */
function mapToContestOutcome(data: any): ContestOutcome {
  return {
    id: data.id,
    ticket_id: data.ticket_id,
    letter_id: data.letter_id,
    user_id: data.user_id,
    outcome: data.outcome,
    outcome_date: data.outcome_date,
    original_amount: data.original_amount,
    final_amount: data.final_amount,
    amount_saved: data.amount_saved,
    violation_type: data.violation_type,
    violation_code: data.violation_code,
    ward: data.ward,
    primary_defense: data.primary_defense,
    secondary_defenses: data.secondary_defenses || [],
    weather_defense_used: data.weather_defense_used || false,
    evidence_types: data.evidence_types || [],
    evidence_count: data.evidence_count || 0,
    hearing_type: data.hearing_type,
    hearing_officer_id: data.hearing_officer_id,
    hearing_date: data.hearing_date,
    letter_quality_score: data.letter_quality_score,
    predicted_win_probability: data.predicted_win_probability,
    actual_outcome_matches_prediction: data.actual_outcome_matches_prediction,
    user_satisfaction: data.user_satisfaction,
    user_feedback: data.user_feedback,
    feature_vector: data.feature_vector,
    created_at: data.created_at,
  };
}

/**
 * Map database row to LearningStats
 */
function mapToLearningStats(data: any): LearningStats {
  return {
    id: data.id,
    category: data.category,
    subcategory: data.subcategory,
    total_cases: data.total_cases || 0,
    wins: data.wins || 0,
    losses: data.losses || 0,
    current_win_rate: data.current_win_rate || 0,
    previous_win_rate: data.previous_win_rate,
    win_rate_trend: data.win_rate_trend,
    last_30_days_cases: data.last_30_days_cases || 0,
    last_30_days_win_rate: data.last_30_days_win_rate,
    last_updated: data.last_updated,
  };
}

/**
 * Determine if outcome matches prediction
 */
export function doesOutcomeMatchPrediction(
  predictedProbability: number,
  actualOutcome: ContestOutcomeType
): boolean {
  const won = actualOutcome === 'dismissed' || actualOutcome === 'reduced';
  const predictedWin = predictedProbability >= 0.5;
  return won === predictedWin;
}

export { MIN_CASES_FOR_TREND, TREND_THRESHOLD };
