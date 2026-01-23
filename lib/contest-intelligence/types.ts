// @ts-nocheck
/**
 * Contest Intelligence System Types
 *
 * Type definitions for ward intelligence, evidence analysis,
 * hearing officer patterns, letter scoring, and outcome tracking.
 */

// ============================================
// Ward Intelligence Types
// ============================================

export interface WardViolationStats {
  contests: number;
  wins: number;
  win_rate: number;
}

export interface WardDefenseStats {
  contests: number;
  wins: number;
  win_rate: number;
}

export interface WardTopArgument {
  argument_type: string;
  win_rate: number;
  sample_size: number;
}

export interface WardSeasonalPattern {
  win_rate: number;
  sample_size?: number;
}

export interface WardIntelligence {
  ward: number;
  ward_name?: string;
  alderman_name?: string;

  // Overall stats
  total_contests: number;
  total_wins: number;
  total_losses: number;
  overall_win_rate: number;

  // Detailed stats
  violation_stats: Record<string, WardViolationStats>;
  defense_stats: Record<string, WardDefenseStats>;
  top_arguments: WardTopArgument[];
  seasonal_patterns: Record<string, WardSeasonalPattern>;

  // Averages
  avg_days_to_decision?: number;
  avg_fine_amount?: number;
  enforcement_score?: number;

  last_updated: string;
}

export interface WardRecommendation {
  ward: number;
  win_rate: number;
  comparison_to_average: 'above' | 'below' | 'average';
  best_defense: string;
  best_defense_win_rate: number;
  tips: string[];
}

// ============================================
// Hearing Officer Types
// ============================================

export interface OfficerViolationPattern {
  cases: number;
  dismissed: number;
  rate: number;
}

export interface OfficerDefenseAcceptance {
  presented: number;
  accepted: number;
  rate: number;
}

export interface HearingOfficerPattern {
  id: string;
  officer_id: string;
  officer_name?: string;

  // Overall stats
  total_cases: number;
  total_dismissals: number;
  total_upheld: number;
  overall_dismissal_rate: number;

  // Patterns
  violation_patterns: Record<string, OfficerViolationPattern>;
  defense_acceptance: Record<string, OfficerDefenseAcceptance>;
  evidence_preferences: Record<string, number>;

  // Tendencies
  tends_toward: 'lenient' | 'strict' | 'neutral';
  strictness_score: number;

  // Details
  avg_hearing_duration_minutes?: number;
  prefers_detailed_evidence: boolean;
  pattern_notes: string[];

  last_updated: string;
}

export interface OfficerRecommendation {
  officer_id: string;
  officer_name?: string;
  dismissal_rate: number;
  best_defense_for_officer: string;
  best_defense_acceptance_rate: number;
  evidence_tips: string[];
  strategy_notes: string[];
}

// ============================================
// Signage Database Types
// ============================================

export type SignCondition = 'good' | 'faded' | 'damaged' | 'obscured' | 'missing';

export interface SignageReport {
  id: string;
  latitude: number;
  longitude: number;
  address?: string;
  ward?: number;

  sign_type: string;
  sign_text?: string;
  restriction_hours?: string;

  condition: SignCondition;
  obstruction_type?: string;

  photo_urls: string[];

  reported_by?: string;
  verified: boolean;
  verified_at?: string;

  used_in_contests: number;
  contest_win_rate?: number;

  street_view_url?: string;
  street_view_date?: string;

  last_verified?: string;
  created_at: string;
}

export interface NearbySignage {
  report: SignageReport;
  distance_feet: number;
  relevance_to_ticket: 'high' | 'medium' | 'low';
  can_support_defense: boolean;
  defense_notes?: string;
}

// ============================================
// Letter Quality Scoring Types
// ============================================

export interface ScoreBreakdown {
  has_signage_defense: boolean;
  has_weather_data: boolean;
  has_photographic_evidence: boolean;
  has_payment_proof: boolean;
  has_renewal_proof: boolean;
  has_witness_statement: boolean;
  argument_matches_violation: boolean;
  includes_legal_citation: boolean;
  personalized_details: boolean;
  proper_formatting: boolean;
}

export interface ImprovementSuggestion {
  action: string;
  potential_boost: number;
  priority: 'high' | 'medium' | 'low';
  evidence_type?: string;
}

export interface LetterQualityScore {
  id: string;
  letter_id: string;
  ticket_id: string;

  overall_score: number;

  // Component scores
  argument_strength: number;
  evidence_quality: number;
  legal_accuracy: number;
  personalization: number;
  completeness: number;

  score_breakdown: ScoreBreakdown;
  improvement_suggestions: ImprovementSuggestion[];

  predicted_win_probability: number;
  confidence_level: number;
  percentile_rank: number;

  scored_at: string;
}

export interface ScoreResult {
  score: LetterQualityScore;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  top_improvements: ImprovementSuggestion[];
}

// ============================================
// Outcome Learning Types
// ============================================

export type ContestOutcomeType = 'dismissed' | 'reduced' | 'upheld' | 'default_judgment' | 'continued' | 'unknown';
export type HearingType = 'written' | 'administrative' | 'court';

export interface ContestOutcome {
  id: string;
  ticket_id: string;
  letter_id?: string;
  user_id: string;

  outcome: ContestOutcomeType;
  outcome_date?: string;

  original_amount?: number;
  final_amount?: number;
  amount_saved?: number;

  violation_type?: string;
  violation_code?: string;
  ward?: number;

  primary_defense?: string;
  secondary_defenses: string[];
  weather_defense_used: boolean;

  evidence_types: string[];
  evidence_count: number;

  hearing_type?: HearingType;
  hearing_officer_id?: string;
  hearing_date?: string;

  letter_quality_score?: number;
  predicted_win_probability?: number;
  actual_outcome_matches_prediction?: boolean;

  user_satisfaction?: number;
  user_feedback?: string;

  feature_vector?: Record<string, number>;

  created_at: string;
}

export interface LearningStats {
  id: string;
  category: 'violation' | 'defense' | 'ward' | 'officer' | 'evidence';
  subcategory: string;

  total_cases: number;
  wins: number;
  losses: number;

  current_win_rate: number;
  previous_win_rate?: number;
  win_rate_trend?: 'up' | 'down' | 'stable';

  last_30_days_cases: number;
  last_30_days_win_rate?: number;

  last_updated: string;
}

// ============================================
// Tow/Boot Alert Types
// ============================================

export type TowAlertType = 'tow' | 'boot' | 'impound';
export type TowAlertStatus = 'active' | 'resolved' | 'vehicle_retrieved' | 'contested';

export interface TowBootAlert {
  id: string;
  user_id: string;
  vehicle_id?: string;

  alert_type: TowAlertType;

  plate: string;
  state: string;

  tow_location?: string;
  impound_location?: string;
  impound_address?: string;
  impound_phone?: string;

  tow_date?: string;
  discovered_at: string;

  related_ticket_ids: string[];
  total_ticket_amount?: number;
  tow_fee?: number;
  daily_storage_fee?: number;
  boot_fee?: number;
  total_fees?: number;

  status: TowAlertStatus;

  contesting_tow: boolean;
  tow_contest_filed_at?: string;
  tow_contest_outcome?: string;

  user_notified: boolean;
  notified_at?: string;
  notification_method?: string;

  resolved_at?: string;
  amount_paid?: number;
  amount_waived?: number;

  created_at: string;
}

// ============================================
// Evidence Analysis Types
// ============================================

export type EvidenceType = 'photo' | 'screenshot' | 'document' | 'receipt' | 'video';
export type EvidenceCategory =
  | 'parking_payment'
  | 'renewal_proof'
  | 'signage_photo'
  | 'location_proof'
  | 'meter_photo'
  | 'vehicle_photo'
  | 'other';

export interface EvidenceAnalysis {
  id: string;
  ticket_id: string;
  user_id: string;

  evidence_type: EvidenceType;
  file_url?: string;
  file_name?: string;

  extracted_text?: string;
  extracted_data?: Record<string, any>;

  evidence_category?: EvidenceCategory;
  relevance_score: number;
  quality_score: number;

  // Parking payment specific
  payment_app?: string;
  payment_time?: string;
  payment_zone?: string;
  payment_amount?: number;
  session_start?: string;
  session_end?: string;

  // Renewal receipt specific
  renewal_type?: string;
  renewal_date?: string;
  effective_date?: string;
  confirmation_number?: string;

  // Signage photo specific
  sign_readable?: boolean;
  sign_condition?: string;
  sign_obstruction?: string;

  validates_defense: boolean;
  validation_notes?: string;
  analysis_summary?: string;

  analyzed_at: string;
}

export interface EvidenceAnalysisResult {
  analysis: EvidenceAnalysis;
  defense_impact: {
    strengthens_case: boolean;
    impact_score: number;
    suggested_use: string;
  };
  warnings?: string[];
}

// ============================================
// Platform Metrics Types
// ============================================

export interface PlatformMetrics {
  id: string;
  metric_date: string;

  total_contests_filed: number;
  contests_won: number;
  contests_lost: number;
  contests_pending: number;

  total_fines_contested: number;
  total_savings: number;
  average_savings_per_win?: number;

  win_rates_by_violation: Record<string, number>;
  win_rates_by_ward: Record<string, number>;
  win_rates_by_defense: Record<string, number>;

  active_users: number;
  new_users: number;
  tickets_per_user?: number;

  letters_generated: number;
  letters_mailed: number;
  letters_delivered: number;

  evidence_submitted: number;
  avg_evidence_per_contest?: number;

  avg_days_to_outcome?: number;

  created_at: string;
}

export interface UserContestMetrics {
  user_id: string;

  total_contests: number;
  total_wins: number;
  total_losses: number;
  win_rate: number;

  total_fines_faced: number;
  total_savings: number;
  total_paid: number;

  current_win_streak: number;
  longest_win_streak: number;

  stats_by_violation: Record<string, { contests: number; wins: number; win_rate: number }>;

  badges: Badge[];

  last_contest_date?: string;
  last_win_date?: string;

  updated_at: string;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned_at: string;
}

// ============================================
// API Response Types
// ============================================

export interface IntelligenceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface ContestRecommendation {
  should_contest: boolean;
  confidence: number;
  estimated_win_rate: number;

  ward_intelligence?: WardRecommendation;
  officer_recommendation?: OfficerRecommendation;
  nearby_signage?: NearbySignage[];

  recommended_defense: string;
  recommended_evidence: string[];

  letter_quality_target: number;
  improvement_opportunities: ImprovementSuggestion[];

  similar_case_outcomes: {
    total_similar: number;
    won: number;
    lost: number;
    avg_savings: number;
  };
}
