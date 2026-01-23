// @ts-nocheck
/**
 * Hearing Officer Pattern Analysis
 *
 * Tracks hearing officer tendencies, dismissal patterns,
 * and generates recommendations for how to present cases.
 */

import { createClient } from '@supabase/supabase-js';
import {
  HearingOfficerPattern,
  OfficerRecommendation,
  OfficerViolationPattern,
  OfficerDefenseAcceptance,
} from './types';

// Threshold for considering data statistically meaningful
const MIN_CASES_FOR_PATTERN = 10;
const MIN_CASES_FOR_RECOMMENDATION = 20;

/**
 * Get hearing officer patterns from database
 */
export async function getOfficerPatterns(
  supabase: ReturnType<typeof createClient>,
  officerId: string
): Promise<HearingOfficerPattern | null> {
  const { data, error } = await supabase
    .from('hearing_officer_patterns')
    .select('*')
    .eq('officer_id', officerId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    officer_id: data.officer_id,
    officer_name: data.officer_name,
    total_cases: data.total_cases || 0,
    total_dismissals: data.total_dismissals || 0,
    total_upheld: data.total_upheld || 0,
    overall_dismissal_rate: data.overall_dismissal_rate || 0,
    violation_patterns: data.violation_patterns || {},
    defense_acceptance: data.defense_acceptance || {},
    evidence_preferences: data.evidence_preferences || {},
    tends_toward: data.tends_toward || 'neutral',
    strictness_score: data.strictness_score || 0.5,
    avg_hearing_duration_minutes: data.avg_hearing_duration_minutes,
    prefers_detailed_evidence: data.prefers_detailed_evidence ?? true,
    pattern_notes: data.pattern_notes || [],
    last_updated: data.last_updated,
  };
}

/**
 * Get officer data from existing FOIA tables (fallback)
 */
export async function getOfficerFromFOIA(
  supabase: ReturnType<typeof createClient>,
  officerBadge: string
): Promise<HearingOfficerPattern | null> {
  const { data, error } = await supabase
    .from('officer_win_rates')
    .select('*')
    .eq('officer_badge', officerBadge)
    .single();

  if (error || !data) {
    return null;
  }

  // Calculate tendency based on loss rate (which is actually dismissal rate from FOIA perspective)
  const dismissalRate = data.loss_rate_percent ? data.loss_rate_percent / 100 : 0.5;
  const tendency: 'lenient' | 'strict' | 'neutral' =
    dismissalRate > 0.55 ? 'lenient' : dismissalRate < 0.35 ? 'strict' : 'neutral';

  return {
    id: '',
    officer_id: officerBadge,
    officer_name: data.officer_name,
    total_cases: data.total_cases || 0,
    total_dismissals: Math.round((data.total_cases || 0) * dismissalRate),
    total_upheld: Math.round((data.total_cases || 0) * (1 - dismissalRate)),
    overall_dismissal_rate: dismissalRate,
    violation_patterns: {},
    defense_acceptance: {},
    evidence_preferences: {},
    tends_toward: tendency,
    strictness_score: 1 - dismissalRate,
    avg_hearing_duration_minutes: undefined,
    prefers_detailed_evidence: true,
    pattern_notes: [],
    last_updated: new Date().toISOString(),
  };
}

/**
 * Get all officers sorted by dismissal rate
 */
export async function getAllOfficerPatterns(
  supabase: ReturnType<typeof createClient>,
  options?: { minCases?: number; sortBy?: 'dismissal_rate' | 'total_cases' }
): Promise<HearingOfficerPattern[]> {
  const minCases = options?.minCases || MIN_CASES_FOR_PATTERN;
  const sortBy = options?.sortBy || 'dismissal_rate';

  // Try new table first
  const { data: newData } = await supabase
    .from('hearing_officer_patterns')
    .select('*')
    .gte('total_cases', minCases)
    .order(sortBy === 'dismissal_rate' ? 'overall_dismissal_rate' : 'total_cases', { ascending: false });

  if (newData && newData.length > 0) {
    return newData.map(mapToOfficerPattern);
  }

  // Fallback to FOIA data
  const { data: foiaData } = await supabase
    .from('officer_win_rates')
    .select('*')
    .gte('total_cases', minCases)
    .order('loss_rate_percent', { ascending: false });

  if (!foiaData) return [];

  return foiaData.map((d) => {
    const dismissalRate = d.loss_rate_percent ? d.loss_rate_percent / 100 : 0.5;
    const tendency: 'lenient' | 'strict' | 'neutral' =
      dismissalRate > 0.55 ? 'lenient' : dismissalRate < 0.35 ? 'strict' : 'neutral';

    return {
      id: '',
      officer_id: d.officer_badge,
      officer_name: d.officer_name,
      total_cases: d.total_cases || 0,
      total_dismissals: Math.round((d.total_cases || 0) * dismissalRate),
      total_upheld: Math.round((d.total_cases || 0) * (1 - dismissalRate)),
      overall_dismissal_rate: dismissalRate,
      violation_patterns: {},
      defense_acceptance: {},
      evidence_preferences: {},
      tends_toward: tendency,
      strictness_score: 1 - dismissalRate,
      avg_hearing_duration_minutes: undefined,
      prefers_detailed_evidence: true,
      pattern_notes: [],
      last_updated: new Date().toISOString(),
    };
  });
}

/**
 * Map database row to HearingOfficerPattern
 */
function mapToOfficerPattern(data: any): HearingOfficerPattern {
  return {
    id: data.id,
    officer_id: data.officer_id,
    officer_name: data.officer_name,
    total_cases: data.total_cases || 0,
    total_dismissals: data.total_dismissals || 0,
    total_upheld: data.total_upheld || 0,
    overall_dismissal_rate: data.overall_dismissal_rate || 0,
    violation_patterns: data.violation_patterns || {},
    defense_acceptance: data.defense_acceptance || {},
    evidence_preferences: data.evidence_preferences || {},
    tends_toward: data.tends_toward || 'neutral',
    strictness_score: data.strictness_score || 0.5,
    avg_hearing_duration_minutes: data.avg_hearing_duration_minutes,
    prefers_detailed_evidence: data.prefers_detailed_evidence ?? true,
    pattern_notes: data.pattern_notes || [],
    last_updated: data.last_updated,
  };
}

/**
 * Generate recommendation for presenting to specific officer
 */
export function generateOfficerRecommendation(
  pattern: HearingOfficerPattern,
  violationType?: string
): OfficerRecommendation {
  // Find best defense for this officer
  let bestDefense = 'general';
  let bestDefenseRate = pattern.overall_dismissal_rate;

  if (Object.keys(pattern.defense_acceptance).length > 0) {
    for (const [defense, stats] of Object.entries(pattern.defense_acceptance)) {
      if (stats.presented >= MIN_CASES_FOR_PATTERN && stats.rate > bestDefenseRate) {
        bestDefense = defense;
        bestDefenseRate = stats.rate;
      }
    }
  }

  // Generate evidence tips based on preferences
  const evidenceTips: string[] = [];
  if (pattern.evidence_preferences) {
    const sortedEvidence = Object.entries(pattern.evidence_preferences)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3);

    for (const [evidenceType, acceptanceRate] of sortedEvidence) {
      if ((acceptanceRate as number) > 0.6) {
        evidenceTips.push(`${formatEvidenceType(evidenceType)} evidence is well-received by this officer (${Math.round((acceptanceRate as number) * 100)}% acceptance)`);
      }
    }
  }

  if (evidenceTips.length === 0) {
    evidenceTips.push('Provide comprehensive documentation to support your defense');
  }

  // Generate strategy notes
  const strategyNotes: string[] = [];

  if (pattern.tends_toward === 'lenient') {
    strategyNotes.push('This officer has a favorable dismissal rate - present your case clearly and you have good odds');
  } else if (pattern.tends_toward === 'strict') {
    strategyNotes.push('This officer is stricter than average - focus on strong, verifiable evidence');
    strategyNotes.push('Avoid emotional arguments; stick to facts and documentation');
  } else {
    strategyNotes.push('This officer rules fairly consistently - present a balanced case');
  }

  if (pattern.prefers_detailed_evidence) {
    strategyNotes.push('This officer responds well to detailed, well-organized evidence');
  }

  // Add violation-specific notes if available
  if (violationType && pattern.violation_patterns[violationType]) {
    const vp = pattern.violation_patterns[violationType];
    if (vp.cases >= MIN_CASES_FOR_PATTERN) {
      const violationRate = vp.rate;
      if (violationRate > pattern.overall_dismissal_rate + 0.1) {
        strategyNotes.push(`Good news: This officer dismisses ${violationType.replace(/_/g, ' ')} tickets at a higher rate (${Math.round(violationRate * 100)}%)`);
      } else if (violationRate < pattern.overall_dismissal_rate - 0.1) {
        strategyNotes.push(`Note: This officer is stricter on ${violationType.replace(/_/g, ' ')} tickets - extra evidence recommended`);
      }
    }
  }

  // Add pattern notes
  if (pattern.pattern_notes && pattern.pattern_notes.length > 0) {
    strategyNotes.push(...pattern.pattern_notes);
  }

  return {
    officer_id: pattern.officer_id,
    officer_name: pattern.officer_name,
    dismissal_rate: pattern.overall_dismissal_rate,
    best_defense_for_officer: bestDefense,
    best_defense_acceptance_rate: bestDefenseRate,
    evidence_tips: evidenceTips,
    strategy_notes: strategyNotes,
  };
}

/**
 * Format evidence type for display
 */
function formatEvidenceType(type: string): string {
  const formats: Record<string, string> = {
    photos: 'Photographic',
    receipts: 'Receipt',
    witness_statements: 'Witness statement',
    official_documents: 'Official document',
    payment_proof: 'Payment',
    renewal_proof: 'Renewal documentation',
    signage_photos: 'Signage photo',
    dashcam: 'Video/dashcam',
  };
  return formats[type] || type.replace(/_/g, ' ');
}

/**
 * Update officer patterns with new outcome
 */
export async function updateOfficerPatterns(
  supabase: ReturnType<typeof createClient>,
  officerId: string,
  outcome: {
    dismissed: boolean;
    violation_type: string;
    defense_type?: string;
    evidence_types?: string[];
  }
): Promise<void> {
  // Get current patterns
  let pattern = await getOfficerPatterns(supabase, officerId);

  if (!pattern) {
    // Initialize new officer record
    pattern = {
      id: '',
      officer_id: officerId,
      officer_name: undefined,
      total_cases: 0,
      total_dismissals: 0,
      total_upheld: 0,
      overall_dismissal_rate: 0,
      violation_patterns: {},
      defense_acceptance: {},
      evidence_preferences: {},
      tends_toward: 'neutral',
      strictness_score: 0.5,
      avg_hearing_duration_minutes: undefined,
      prefers_detailed_evidence: true,
      pattern_notes: [],
      last_updated: new Date().toISOString(),
    };
  }

  // Update totals
  pattern.total_cases += 1;
  if (outcome.dismissed) {
    pattern.total_dismissals += 1;
  } else {
    pattern.total_upheld += 1;
  }
  pattern.overall_dismissal_rate = pattern.total_dismissals / pattern.total_cases;

  // Update tendency based on new rate
  pattern.strictness_score = 1 - pattern.overall_dismissal_rate;
  pattern.tends_toward =
    pattern.overall_dismissal_rate > 0.55 ? 'lenient' :
    pattern.overall_dismissal_rate < 0.35 ? 'strict' : 'neutral';

  // Update violation patterns
  if (!pattern.violation_patterns[outcome.violation_type]) {
    pattern.violation_patterns[outcome.violation_type] = {
      cases: 0,
      dismissed: 0,
      rate: 0,
    };
  }
  const vp = pattern.violation_patterns[outcome.violation_type];
  vp.cases += 1;
  if (outcome.dismissed) vp.dismissed += 1;
  vp.rate = vp.dismissed / vp.cases;

  // Update defense acceptance
  if (outcome.defense_type) {
    if (!pattern.defense_acceptance[outcome.defense_type]) {
      pattern.defense_acceptance[outcome.defense_type] = {
        presented: 0,
        accepted: 0,
        rate: 0,
      };
    }
    const da = pattern.defense_acceptance[outcome.defense_type];
    da.presented += 1;
    if (outcome.dismissed) da.accepted += 1;
    da.rate = da.accepted / da.presented;
  }

  // Update evidence preferences
  if (outcome.evidence_types && outcome.evidence_types.length > 0) {
    for (const evidenceType of outcome.evidence_types) {
      if (!pattern.evidence_preferences[evidenceType]) {
        pattern.evidence_preferences[evidenceType] = 0;
      }
      // Running average of acceptance when this evidence type is presented
      const currentPref = pattern.evidence_preferences[evidenceType] as number;
      const newValue = outcome.dismissed ? 1 : 0;
      pattern.evidence_preferences[evidenceType] = (currentPref + newValue) / 2;
    }
  }

  pattern.last_updated = new Date().toISOString();

  // Upsert to database
  await supabase.from('hearing_officer_patterns').upsert({
    officer_id: pattern.officer_id,
    officer_name: pattern.officer_name,
    total_cases: pattern.total_cases,
    total_dismissals: pattern.total_dismissals,
    total_upheld: pattern.total_upheld,
    overall_dismissal_rate: pattern.overall_dismissal_rate,
    violation_patterns: pattern.violation_patterns,
    defense_acceptance: pattern.defense_acceptance,
    evidence_preferences: pattern.evidence_preferences,
    tends_toward: pattern.tends_toward,
    strictness_score: pattern.strictness_score,
    prefers_detailed_evidence: pattern.prefers_detailed_evidence,
    pattern_notes: pattern.pattern_notes,
    last_updated: pattern.last_updated,
  }, { onConflict: 'officer_id' });
}

/**
 * Get top officers by dismissal rate for a violation type
 */
export async function getTopOfficersForViolation(
  supabase: ReturnType<typeof createClient>,
  violationType: string,
  limit: number = 10
): Promise<Array<{ officer_id: string; officer_name?: string; dismissal_rate: number; cases: number }>> {
  const allOfficers = await getAllOfficerPatterns(supabase, { minCases: MIN_CASES_FOR_PATTERN });

  // Filter and sort by violation-specific dismissal rate
  const officersWithViolation = allOfficers
    .filter(o => o.violation_patterns[violationType]?.cases >= MIN_CASES_FOR_PATTERN)
    .map(o => ({
      officer_id: o.officer_id,
      officer_name: o.officer_name,
      dismissal_rate: o.violation_patterns[violationType].rate,
      cases: o.violation_patterns[violationType].cases,
    }))
    .sort((a, b) => b.dismissal_rate - a.dismissal_rate)
    .slice(0, limit);

  return officersWithViolation;
}

/**
 * Calculate compatibility score between a case and an officer
 */
export function calculateOfficerCompatibility(
  pattern: HearingOfficerPattern,
  caseDetails: {
    violation_type: string;
    defense_type: string;
    evidence_types: string[];
  }
): number {
  let score = 0.5; // Base score

  // Officer's general leniency
  score += (pattern.overall_dismissal_rate - 0.5) * 0.3;

  // Violation-specific rate
  if (pattern.violation_patterns[caseDetails.violation_type]) {
    const vp = pattern.violation_patterns[caseDetails.violation_type];
    if (vp.cases >= MIN_CASES_FOR_PATTERN) {
      score += (vp.rate - pattern.overall_dismissal_rate) * 0.3;
    }
  }

  // Defense acceptance
  if (pattern.defense_acceptance[caseDetails.defense_type]) {
    const da = pattern.defense_acceptance[caseDetails.defense_type];
    if (da.presented >= MIN_CASES_FOR_PATTERN) {
      score += (da.rate - pattern.overall_dismissal_rate) * 0.2;
    }
  }

  // Evidence match
  if (caseDetails.evidence_types.length > 0 && Object.keys(pattern.evidence_preferences).length > 0) {
    const avgPreference = caseDetails.evidence_types
      .filter(et => pattern.evidence_preferences[et] !== undefined)
      .map(et => pattern.evidence_preferences[et] as number)
      .reduce((sum, val) => sum + val, 0) / Math.max(caseDetails.evidence_types.length, 1);

    score += (avgPreference - 0.5) * 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

export { MIN_CASES_FOR_PATTERN, MIN_CASES_FOR_RECOMMENDATION };
