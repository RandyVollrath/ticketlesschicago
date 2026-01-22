/**
 * Letter Quality Scoring System
 *
 * Scores contest letters on multiple dimensions and provides
 * improvement suggestions to maximize win probability.
 */

import { createClient } from '@supabase/supabase-js';
import {
  LetterQualityScore,
  ScoreBreakdown,
  ImprovementSuggestion,
  ScoreResult,
} from './types';
import { getContestKit } from '../contest-kits';

// Weights for each component (must sum to 1)
const COMPONENT_WEIGHTS = {
  argument_strength: 0.30,
  evidence_quality: 0.30,
  legal_accuracy: 0.15,
  personalization: 0.10,
  completeness: 0.15,
};

// Base win rates by violation type (from FOIA data)
const BASE_WIN_RATES: Record<string, number> = {
  expired_plates: 0.75,
  no_city_sticker: 0.70,
  disabled_zone: 0.68,
  expired_meter: 0.67,
  commercial_loading: 0.59,
  no_standing_time_restricted: 0.58,
  missing_plate: 0.54,
  residential_permit: 0.54,
  fire_hydrant: 0.44,
  rush_hour: 0.37,
  street_cleaning: 0.34,
  snow_route: 0.30,
  double_parking: 0.25,
  parking_alley: 0.25,
  bus_stop: 0.20,
  bike_lane: 0.18,
  other_unknown: 0.30,
};

// Evidence impact scores
const EVIDENCE_IMPACT: Record<string, number> = {
  parking_payment_screenshot: 0.15,
  renewal_proof: 0.15,
  signage_photo: 0.12,
  meter_photo: 0.10,
  location_photo: 0.08,
  witness_statement: 0.08,
  official_document: 0.12,
  receipt: 0.10,
  dashcam_footage: 0.10,
  weather_data: 0.08,
};

interface TicketData {
  ticket_id: string;
  violation_type: string;
  violation_code?: string;
  location?: string;
  ticket_date?: string;
  amount?: number;
}

interface LetterData {
  letter_id: string;
  letter_content: string;
  defense_type?: string;
  evidence_integrated?: boolean;
}

interface EvidenceData {
  has_photos: boolean;
  photo_types: string[];
  has_payment_proof: boolean;
  has_renewal_proof: boolean;
  has_signage_photo: boolean;
  has_weather_data: boolean;
  has_witness: boolean;
  has_official_docs: boolean;
  evidence_count: number;
}

/**
 * Score a contest letter
 */
export function scoreContestLetter(
  ticket: TicketData,
  letter: LetterData,
  evidence: EvidenceData
): ScoreResult {
  const kit = getContestKit(ticket.violation_code || '');
  const baseWinRate = BASE_WIN_RATES[ticket.violation_type] || 0.30;

  // Score each component
  const argumentStrength = scoreArgumentStrength(letter, ticket, kit);
  const evidenceQuality = scoreEvidenceQuality(evidence, ticket.violation_type);
  const legalAccuracy = scoreLegalAccuracy(letter, kit);
  const personalization = scorePersonalization(letter, ticket);
  const completeness = scoreCompleteness(letter, evidence, kit);

  // Calculate weighted overall score
  const overallScore = Math.round(
    argumentStrength * COMPONENT_WEIGHTS.argument_strength +
    evidenceQuality * COMPONENT_WEIGHTS.evidence_quality +
    legalAccuracy * COMPONENT_WEIGHTS.legal_accuracy +
    personalization * COMPONENT_WEIGHTS.personalization +
    completeness * COMPONENT_WEIGHTS.completeness
  );

  // Generate score breakdown
  const scoreBreakdown = generateScoreBreakdown(letter, evidence, ticket);

  // Generate improvement suggestions
  const improvements = generateImprovementSuggestions(
    { argument_strength: argumentStrength, evidence_quality: evidenceQuality, legal_accuracy: legalAccuracy, personalization, completeness },
    scoreBreakdown,
    ticket.violation_type
  );

  // Calculate predicted win probability
  const predictedWinProbability = calculateWinProbability(
    baseWinRate,
    overallScore,
    evidence,
    ticket.violation_type
  );

  // Determine grade
  const grade = getGrade(overallScore);

  // Create the score object
  const score: LetterQualityScore = {
    id: '', // Will be set when saved
    letter_id: letter.letter_id,
    ticket_id: ticket.ticket_id,
    overall_score: overallScore,
    argument_strength: argumentStrength,
    evidence_quality: evidenceQuality,
    legal_accuracy: legalAccuracy,
    personalization,
    completeness,
    score_breakdown: scoreBreakdown,
    improvement_suggestions: improvements,
    predicted_win_probability: predictedWinProbability,
    confidence_level: calculateConfidence(evidence, ticket.violation_type),
    percentile_rank: 0, // Calculated when compared to other letters
    scored_at: new Date().toISOString(),
  };

  return {
    score,
    grade,
    summary: generateSummary(grade, overallScore, predictedWinProbability, improvements),
    top_improvements: improvements.filter(i => i.priority === 'high').slice(0, 3),
  };
}

/**
 * Score argument strength (0-100)
 */
function scoreArgumentStrength(
  letter: LetterData,
  ticket: TicketData,
  kit: any
): number {
  let score = 50; // Base score

  const content = letter.letter_content.toLowerCase();

  // Check for strong argument patterns
  const strongPatterns = [
    { pattern: /signage.*(missing|obscured|unclear|damaged|not visible)/i, points: 15 },
    { pattern: /weather.*(rain|snow|ice|storm|inclement)/i, points: 12 },
    { pattern: /meter.*(broken|malfunction|not working|error)/i, points: 15 },
    { pattern: /(renew|purchase).*(before|prior|already)/i, points: 15 },
    { pattern: /placard.*(displayed|visible|valid)/i, points: 15 },
    { pattern: /loading.*(actively|unloading|deliverU)/i, points: 12 },
    { pattern: /(emergency|urgent|medical)/i, points: 10 },
    { pattern: /parked.*(over|more than|beyond)\s*15\s*feet/i, points: 12 },
    { pattern: /restriction.*(hours|time|posted)/i, points: 10 },
  ];

  for (const { pattern, points } of strongPatterns) {
    if (pattern.test(content)) {
      score += points;
    }
  }

  // Check if defense type matches best arguments for violation
  if (kit && letter.defense_type) {
    const primaryDefense = kit.arguments?.primary;
    if (primaryDefense && primaryDefense.category === letter.defense_type) {
      score += 10;
    }
  }

  // Penalize weak arguments
  const weakPatterns = [
    { pattern: /forgot|didn't know|wasn't aware/i, points: -10 },
    { pattern: /only (there|parked) for (a minute|a second)/i, points: -8 },
    { pattern: /everyone else was/i, points: -5 },
    { pattern: /unfair|not fair/i, points: -3 },
  ];

  for (const { pattern, points } of weakPatterns) {
    if (pattern.test(content)) {
      score += points;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score evidence quality (0-100)
 */
function scoreEvidenceQuality(evidence: EvidenceData, violationType: string): number {
  let score = 20; // Base score for having any case

  // Add points for evidence
  if (evidence.has_photos) {
    score += 15;
    score += Math.min(evidence.photo_types.length * 5, 15);
  }

  if (evidence.has_payment_proof) {
    score += violationType === 'expired_meter' ? 25 : 15;
  }

  if (evidence.has_renewal_proof) {
    score += ['expired_plates', 'no_city_sticker'].includes(violationType) ? 25 : 10;
  }

  if (evidence.has_signage_photo) {
    score += ['street_cleaning', 'residential_permit', 'no_standing_time_restricted'].includes(violationType) ? 20 : 10;
  }

  if (evidence.has_weather_data) {
    score += ['street_cleaning', 'snow_route', 'fire_hydrant'].includes(violationType) ? 15 : 8;
  }

  if (evidence.has_witness) {
    score += 10;
  }

  if (evidence.has_official_docs) {
    score += 15;
  }

  // Bonus for multiple evidence types
  if (evidence.evidence_count >= 3) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score legal accuracy (0-100)
 */
function scoreLegalAccuracy(letter: LetterData, kit: any): number {
  let score = 60; // Base score

  const content = letter.letter_content.toLowerCase();

  // Check for legal citations
  if (/municipal code|ordinance|9-\d{2}-\d{3}/i.test(content)) {
    score += 15;
  }

  // Check for proper legal language
  const legalPhrases = [
    'respectfully contest',
    'respectfully request',
    'hereby contest',
    'pursuant to',
    'in accordance with',
    'dismiss this citation',
    'dismiss this ticket',
  ];

  for (const phrase of legalPhrases) {
    if (content.includes(phrase)) {
      score += 5;
    }
  }

  // Check for proper format
  if (content.includes('dear') && content.includes('sincerely')) {
    score += 5;
  }

  // Check if legal grounds match violation type
  if (kit) {
    const primaryArg = kit.arguments?.primary?.template?.toLowerCase() || '';
    // Check if letter contains key phrases from the kit template
    const keyPhrases = primaryArg.match(/\b\w{6,}\b/g) || [];
    const matchedPhrases = keyPhrases.filter((phrase: string) =>
      content.includes(phrase.toLowerCase())
    );
    if (matchedPhrases.length > 3) {
      score += 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score personalization (0-100)
 */
function scorePersonalization(letter: LetterData, ticket: TicketData): number {
  let score = 40; // Base score

  const content = letter.letter_content;

  // Check for ticket-specific details
  if (ticket.location && content.includes(ticket.location)) {
    score += 20;
  }

  if (ticket.ticket_date && content.includes(ticket.ticket_date)) {
    score += 10;
  }

  // Check for specific details (not just template fill-ins)
  const specificPatterns = [
    /at approximately \d{1,2}:\d{2}/i, // Specific time
    /\d+ (feet|yards|meters)/i, // Specific distance
    /\$\d+(\.\d{2})?/i, // Specific amount
    /on (january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}/i, // Specific date
  ];

  for (const pattern of specificPatterns) {
    if (pattern.test(content)) {
      score += 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score completeness (0-100)
 */
function scoreCompleteness(letter: LetterData, evidence: EvidenceData, kit: any): number {
  let score = 50; // Base score

  const content = letter.letter_content.toLowerCase();

  // Check for required elements
  const requiredElements = [
    { pattern: /ticket.*(number|#)/i, points: 10 },
    { pattern: /violation.*(date|occurred|issued)/i, points: 10 },
    { pattern: /request.*(dismiss|dismissal|void)/i, points: 10 },
    { pattern: /(attached|enclosed|included).*(evidence|photo|document)/i, points: 10 },
  ];

  for (const { pattern, points } of requiredElements) {
    if (pattern.test(content)) {
      score += points;
    }
  }

  // Check evidence integration
  if (letter.evidence_integrated && evidence.evidence_count > 0) {
    score += 15;
  }

  // Check word count (not too short, not too long)
  const wordCount = content.split(/\s+/).length;
  if (wordCount >= 150 && wordCount <= 500) {
    score += 10;
  } else if (wordCount < 100) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate score breakdown
 */
function generateScoreBreakdown(
  letter: LetterData,
  evidence: EvidenceData,
  ticket: TicketData
): ScoreBreakdown {
  const content = letter.letter_content.toLowerCase();

  return {
    has_signage_defense: /signage.*(missing|obscured|unclear)/i.test(content),
    has_weather_data: evidence.has_weather_data || /weather|rain|snow/i.test(content),
    has_photographic_evidence: evidence.has_photos,
    has_payment_proof: evidence.has_payment_proof,
    has_renewal_proof: evidence.has_renewal_proof,
    has_witness_statement: evidence.has_witness,
    argument_matches_violation: true, // Would need more context to verify
    includes_legal_citation: /municipal code|ordinance|9-\d{2}-\d{3}/i.test(content),
    personalized_details: ticket.location ? content.includes(ticket.location.toLowerCase()) : false,
    proper_formatting: content.includes('dear') && (content.includes('sincerely') || content.includes('respectfully')),
  };
}

/**
 * Generate improvement suggestions
 */
function generateImprovementSuggestions(
  scores: Record<string, number>,
  breakdown: ScoreBreakdown,
  violationType: string
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  // Evidence-based suggestions
  if (!breakdown.has_photographic_evidence) {
    suggestions.push({
      action: 'Add photos of the location or signage',
      potential_boost: 15,
      priority: 'high',
      evidence_type: 'photo',
    });
  }

  if (!breakdown.has_signage_defense && ['street_cleaning', 'residential_permit', 'no_standing_time_restricted'].includes(violationType)) {
    suggestions.push({
      action: 'Document any signage issues (missing, obscured, or confusing signs)',
      potential_boost: 12,
      priority: 'high',
      evidence_type: 'signage_photo',
    });
  }

  if (!breakdown.has_payment_proof && violationType === 'expired_meter') {
    suggestions.push({
      action: 'Add parking app payment screenshot if you paid via mobile',
      potential_boost: 20,
      priority: 'high',
      evidence_type: 'parking_payment_screenshot',
    });
  }

  if (!breakdown.has_renewal_proof && ['expired_plates', 'no_city_sticker'].includes(violationType)) {
    suggestions.push({
      action: 'Add renewal confirmation or receipt showing purchase date',
      potential_boost: 20,
      priority: 'high',
      evidence_type: 'renewal_proof',
    });
  }

  if (!breakdown.has_weather_data && ['street_cleaning', 'snow_route', 'fire_hydrant'].includes(violationType)) {
    suggestions.push({
      action: 'Weather data could support your defense - we can add this automatically',
      potential_boost: 10,
      priority: 'medium',
      evidence_type: 'weather_data',
    });
  }

  // Quality-based suggestions
  if (scores.argument_strength < 60) {
    suggestions.push({
      action: 'Strengthen your argument by focusing on specific legal defenses',
      potential_boost: 10,
      priority: 'medium',
    });
  }

  if (!breakdown.includes_legal_citation) {
    suggestions.push({
      action: 'Add reference to the specific municipal code being contested',
      potential_boost: 8,
      priority: 'low',
    });
  }

  if (!breakdown.personalized_details) {
    suggestions.push({
      action: 'Add specific details about the location and circumstances',
      potential_boost: 8,
      priority: 'medium',
    });
  }

  // Sort by potential boost
  return suggestions.sort((a, b) => b.potential_boost - a.potential_boost);
}

/**
 * Calculate predicted win probability
 */
function calculateWinProbability(
  baseRate: number,
  overallScore: number,
  evidence: EvidenceData,
  violationType: string
): number {
  // Start with base rate
  let probability = baseRate;

  // Adjust based on score (score of 50 = no change, higher/lower adjusts)
  const scoreAdjustment = (overallScore - 50) / 100 * 0.20;
  probability += scoreAdjustment;

  // Evidence bonus
  let evidenceBonus = 0;
  if (evidence.has_payment_proof && violationType === 'expired_meter') {
    evidenceBonus += 0.15;
  }
  if (evidence.has_renewal_proof && ['expired_plates', 'no_city_sticker'].includes(violationType)) {
    evidenceBonus += 0.15;
  }
  if (evidence.has_signage_photo && ['street_cleaning', 'residential_permit'].includes(violationType)) {
    evidenceBonus += 0.10;
  }
  if (evidence.evidence_count >= 3) {
    evidenceBonus += 0.05;
  }

  probability += evidenceBonus;

  // Cap between 0.05 and 0.95
  return Math.max(0.05, Math.min(0.95, probability));
}

/**
 * Calculate confidence level
 */
function calculateConfidence(evidence: EvidenceData, violationType: string): number {
  let confidence = 0.50; // Base confidence

  // More evidence = higher confidence
  confidence += Math.min(evidence.evidence_count * 0.05, 0.20);

  // Known violation types have better data
  if (BASE_WIN_RATES[violationType] !== undefined) {
    confidence += 0.10;
  }

  // Specific evidence types increase confidence
  if (evidence.has_payment_proof || evidence.has_renewal_proof) {
    confidence += 0.10;
  }

  return Math.min(0.95, confidence);
}

/**
 * Get letter grade from score
 */
function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Generate human-readable summary
 */
function generateSummary(
  grade: string,
  score: number,
  winProbability: number,
  improvements: ImprovementSuggestion[]
): string {
  const winPercent = Math.round(winProbability * 100);
  const highPriorityCount = improvements.filter(i => i.priority === 'high').length;

  let summary = `Your letter scores a ${grade} (${score}/100) with an estimated ${winPercent}% chance of success. `;

  if (grade === 'A') {
    summary += 'Excellent! Your letter is well-prepared with strong evidence and arguments.';
  } else if (grade === 'B') {
    summary += 'Good work! A few improvements could make your case even stronger.';
  } else if (grade === 'C') {
    summary += `There are ${highPriorityCount} key areas to improve that could significantly boost your chances.`;
  } else if (grade === 'D') {
    summary += 'Your letter needs significant improvements. Adding evidence is critical.';
  } else {
    summary += 'Consider adding substantial evidence before submitting. Your chances improve dramatically with documentation.';
  }

  return summary;
}

/**
 * Save letter score to database
 */
export async function saveLetterScore(
  supabase: ReturnType<typeof createClient>,
  score: LetterQualityScore
): Promise<string> {
  const { data, error } = await supabase
    .from('letter_quality_scores')
    .insert({
      letter_id: score.letter_id,
      ticket_id: score.ticket_id,
      overall_score: score.overall_score,
      argument_strength: score.argument_strength,
      evidence_quality: score.evidence_quality,
      legal_accuracy: score.legal_accuracy,
      personalization: score.personalization,
      completeness: score.completeness,
      score_breakdown: score.score_breakdown,
      improvement_suggestions: score.improvement_suggestions,
      predicted_win_probability: score.predicted_win_probability,
      confidence_level: score.confidence_level,
      percentile_rank: score.percentile_rank,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save letter score: ${error.message}`);
  }

  return data.id;
}

/**
 * Get score for a letter
 */
export async function getLetterScore(
  supabase: ReturnType<typeof createClient>,
  letterId: string
): Promise<LetterQualityScore | null> {
  const { data, error } = await supabase
    .from('letter_quality_scores')
    .select('*')
    .eq('letter_id', letterId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as LetterQualityScore;
}

export { BASE_WIN_RATES, EVIDENCE_IMPACT };
