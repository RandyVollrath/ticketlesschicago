// @ts-nocheck
/**
 * Contest Intelligence System
 *
 * A comprehensive suite of tools for maximizing ticket contest success rates.
 *
 * Modules:
 * - Ward Intelligence: Ward-specific win rates and strategies
 * - Hearing Officers: Officer pattern analysis and recommendations
 * - Evidence Analysis: Automatic evidence categorization and validation
 * - Letter Scoring: Quality scoring and improvement suggestions
 * - Signage Database: Crowdsourced signage issue tracking
 * - Outcome Learning: Continuous learning from contest results
 * - Tow Alerts: Tow/boot monitoring and alerts
 * - Success Dashboard: Platform and user statistics
 */

// Types
export * from './types';

// Ward Intelligence
export {
  getWardIntelligence,
  getWardFromFOIA,
  getAllWardsIntelligence,
  generateWardRecommendation,
  updateWardIntelligence,
  estimateWardFromAddress,
  CHICAGO_WARDS,
} from './ward-intelligence';

// Hearing Officer Pattern Analysis
export {
  getOfficerPatterns,
  getOfficerFromFOIA,
  getAllOfficerPatterns,
  generateOfficerRecommendation,
  updateOfficerPatterns,
  getTopOfficersForViolation,
  calculateOfficerCompatibility,
  MIN_CASES_FOR_PATTERN,
  MIN_CASES_FOR_RECOMMENDATION,
} from './hearing-officers';

// Evidence Analysis
export {
  analyzeEvidence,
  saveEvidenceAnalysis,
  getTicketEvidenceAnalyses,
  EXTRACTION_PATTERNS,
  SIGN_CONDITION_KEYWORDS,
} from './evidence-analysis';

// Letter Quality Scoring
export {
  scoreContestLetter,
  saveLetterScore,
  getLetterScore,
  BASE_WIN_RATES,
  EVIDENCE_IMPACT,
} from './letter-scoring';

// Signage Database — REMOVED
// Crowdsourced signage reporting was unused. Street View imagery with AI analysis
// is now used instead (see lib/street-view-service.ts).

// Outcome Learning Loop
export {
  recordContestOutcome,
  getOutcomeByTicketId,
  getUserOutcomes,
  getLearningStats,
  getTopDefensesForViolation,
  getWinRateTrends,
  analyzeEvidenceEffectiveness,
  calculatePredictedWinProbability,
  getSimilarCases,
  recordUserFeedback,
  getOverallLearningStats,
  doesOutcomeMatchPrediction,
  MIN_CASES_FOR_TREND,
  TREND_THRESHOLD,
} from './outcome-learning';

// Tow/Boot Alert Integration
export {
  createTowAlert,
  getUserActiveAlerts,
  getUserAlerts,
  getAlert,
  checkForTowedVehicle,
  markAlertNotified,
  updateAlertStatus,
  markTowContested,
  recordTowContestOutcome,
  calculateCurrentFees,
  getImpoundLotInfo,
  getAllImpoundLots,
  generateRetrievalInstructions,
  evaluateTowContestEligibility,
  formatAlertType,
  formatAlertStatus,
  CHICAGO_IMPOUND_LOTS,
  CHICAGO_TOW_FEES,
} from './tow-alerts';

// Success Visibility Dashboard
export {
  getTodaysPlatformMetrics,
  getPlatformMetricsRange,
  getUserContestMetrics,
  getWinLeaderboard,
  getSavingsLeaderboard,
  getDashboardSummary,
  getUserRank,
  formatStreakInfo,
  BADGE_DEFINITIONS,
} from './success-dashboard';

// Composite functions for common use cases

import { createClient } from '@supabase/supabase-js';
import { getWardIntelligence, generateWardRecommendation } from './ward-intelligence';
import { getOfficerPatterns, generateOfficerRecommendation } from './hearing-officers';
// findDefenseSupportingSignage removed — crowdsourced signage database was unused
import { calculatePredictedWinProbability, getSimilarCases } from './outcome-learning';
import { ContestRecommendation, NearbySignage } from './types';

/**
 * Get comprehensive contest recommendation
 * Combines all intelligence sources for a single ticket
 */
export async function getContestRecommendation(
  supabase: ReturnType<typeof createClient>,
  ticketDetails: {
    violation_type: string;
    violation_code?: string;
    ward?: number;
    latitude?: number;
    longitude?: number;
    hearing_officer_id?: string;
    primary_defense?: string;
    evidence_types?: string[];
    letter_quality_score?: number;
  }
): Promise<ContestRecommendation> {
  // Get ward intelligence
  let wardIntelligence = undefined;
  if (ticketDetails.ward) {
    const wardData = await getWardIntelligence(supabase, ticketDetails.ward);
    if (wardData) {
      wardIntelligence = generateWardRecommendation(wardData, ticketDetails.violation_type);
    }
  }

  // Get officer recommendation
  let officerRecommendation = undefined;
  if (ticketDetails.hearing_officer_id) {
    const officerData = await getOfficerPatterns(supabase, ticketDetails.hearing_officer_id);
    if (officerData) {
      officerRecommendation = generateOfficerRecommendation(officerData, ticketDetails.violation_type);
    }
  }

  // Get nearby signage issues
  let nearbySignage: NearbySignage[] = [];
  if (ticketDetails.latitude && ticketDetails.longitude) {
    nearbySignage = await findDefenseSupportingSignage(
      supabase,
      ticketDetails.latitude,
      ticketDetails.longitude,
      ticketDetails.violation_type
    );
  }

  // Calculate predicted win probability
  const prediction = await calculatePredictedWinProbability(supabase, {
    violation_type: ticketDetails.violation_type,
    primary_defense: ticketDetails.primary_defense || 'general',
    ward: ticketDetails.ward,
    evidence_types: ticketDetails.evidence_types || [],
    hearing_officer_id: ticketDetails.hearing_officer_id,
    letter_quality_score: ticketDetails.letter_quality_score,
  });

  // Get similar cases
  const similarCases = await getSimilarCases(supabase, {
    violation_type: ticketDetails.violation_type,
    primary_defense: ticketDetails.primary_defense,
    ward: ticketDetails.ward,
  });

  const wonCases = similarCases.filter(c => c.outcome === 'dismissed' || c.outcome === 'reduced');
  const totalSavings = wonCases.reduce((sum, c) => sum + (c.amount_saved || 0), 0);

  // Determine recommendation
  const shouldContest = prediction.probability >= 0.35 || nearbySignage.length > 0;

  // Determine best defense
  let recommendedDefense = ticketDetails.primary_defense || 'general';
  if (wardIntelligence && wardIntelligence.best_defense_win_rate > prediction.probability) {
    recommendedDefense = wardIntelligence.best_defense;
  }
  if (officerRecommendation && officerRecommendation.best_defense_acceptance_rate > prediction.probability) {
    recommendedDefense = officerRecommendation.best_defense_for_officer;
  }

  // Recommend evidence types
  const recommendedEvidence: string[] = [];
  if (nearbySignage.length > 0) {
    recommendedEvidence.push('signage_photos');
  }
  if (officerRecommendation?.evidence_tips) {
    for (const tip of officerRecommendation.evidence_tips) {
      if (tip.toLowerCase().includes('photo')) recommendedEvidence.push('photos');
      if (tip.toLowerCase().includes('receipt')) recommendedEvidence.push('receipts');
      if (tip.toLowerCase().includes('document')) recommendedEvidence.push('official_documents');
    }
  }
  if (recommendedEvidence.length === 0) {
    recommendedEvidence.push('photos', 'receipts');
  }

  return {
    should_contest: shouldContest,
    confidence: prediction.confidence,
    estimated_win_rate: prediction.probability,
    ward_intelligence: wardIntelligence,
    officer_recommendation: officerRecommendation,
    nearby_signage: nearbySignage,
    recommended_defense: recommendedDefense,
    recommended_evidence: Array.from(new Set(recommendedEvidence)),
    letter_quality_target: 75, // Aim for B grade or higher
    improvement_opportunities: prediction.factors
      .filter(f => f.impact < 0)
      .map(f => ({
        action: `Address ${f.factor} (${Math.round(f.impact * 100)}% impact)`,
        potential_boost: Math.abs(f.impact) * 10,
        priority: Math.abs(f.impact) > 0.1 ? 'high' as const : 'medium' as const,
      })),
    similar_case_outcomes: {
      total_similar: similarCases.length,
      won: wonCases.length,
      lost: similarCases.length - wonCases.length,
      avg_savings: wonCases.length > 0 ? totalSavings / wonCases.length : 0,
    },
  };
}

/**
 * Quick check if a ticket is worth contesting
 */
export async function quickContestCheck(
  supabase: ReturnType<typeof createClient>,
  violationType: string,
  ward?: number
): Promise<{ recommended: boolean; winRate: number; reason: string }> {
  // Get base win rate for violation type
  const { data: violationData } = await supabase
    .from('violation_win_rates')
    .select('*')
    .eq('violation_code', violationType)
    .single();

  let baseWinRate = 0.45; // Default if no data
  if (violationData && violationData.loss_rate_percent) {
    baseWinRate = violationData.loss_rate_percent / 100;
  }

  // Adjust for ward if known
  if (ward) {
    const { data: wardData } = await supabase
      .from('ward_win_rates')
      .select('*')
      .eq('ward', ward)
      .single();

    if (wardData && wardData.loss_rate_percent) {
      const wardRate = wardData.loss_rate_percent / 100;
      // Average the two rates
      baseWinRate = (baseWinRate + wardRate) / 2;
    }
  }

  const recommended = baseWinRate >= 0.35;
  const reason = recommended
    ? `Historical data shows a ${Math.round(baseWinRate * 100)}% success rate for this type of ticket.`
    : `Historical success rate is lower (${Math.round(baseWinRate * 100)}%), but contesting is still free and may be worth trying.`;

  return {
    recommended,
    winRate: baseWinRate,
    reason,
  };
}
