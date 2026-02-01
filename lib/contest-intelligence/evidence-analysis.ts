// @ts-nocheck
/**
 * Evidence Analysis System
 *
 * Analyzes user-submitted evidence using OCR and pattern matching
 * to extract useful information and validate defenses.
 */

import { createClient } from '@supabase/supabase-js';
import {
  EvidenceAnalysis,
  EvidenceAnalysisResult,
  EvidenceType,
  EvidenceCategory,
} from './types';

// Patterns for extracting information from text
const EXTRACTION_PATTERNS = {
  // ParkChicago app patterns
  parkchicago_zone: /zone[:\s]*(\d{3,5})/i,
  parkchicago_session: /session[:\s]*(active|expired|ended)/i,
  parkchicago_time: /(?:started?|begins?)[:\s]*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i,
  parkchicago_expiry: /(?:expires?|ends?)[:\s]*(\d{1,2}:\d{2}\s*(?:am|pm)?)/i,

  // General parking app patterns
  parking_app: /(parkchicago|spothero|parkmobile|parkwhiz|bestparking)/i,
  parking_amount: /(?:paid|amount|total)[:\s]*\$?(\d+\.?\d{0,2})/i,

  // Date patterns
  date_mdy: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
  date_written: /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s*(\d{4})/i,

  // Time patterns
  time_12h: /(\d{1,2}):(\d{2})\s*(am|pm)/i,
  time_24h: /(\d{2}):(\d{2})(?::\d{2})?/,

  // Receipt/confirmation patterns
  confirmation_number: /(?:confirmation|order|reference|receipt)[:\s#]*([A-Z0-9]{6,15})/i,
  transaction_id: /(?:transaction|trans)[:\s#]*(\d{8,20})/i,

  // Renewal patterns
  renewal_date: /(?:renew|valid|effective)[^\n]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  expiration_date: /(?:expir|valid until|through)[^\n]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  sticker_number: /(?:sticker|permit)[:\s#]*(\d{6,12})/i,

  // Amount patterns
  amount: /\$\s*(\d+\.?\d{0,2})/,
  fine_amount: /(?:fine|amount due|penalty)[:\s]*\$?(\d+\.?\d{0,2})/i,

  // License plate patterns
  illinois_plate: /\b([A-Z]{1,3}\s?\d{3,4}|\d{1,3}\s?[A-Z]{2,3})\b/i,

  // Address patterns
  chicago_address: /(\d{1,5}\s+[NSEW]\.?\s+\w+(?:\s+\w+)*(?:\s+(?:ST|AVE|BLVD|DR|RD|CT|PL|WAY)))/i,
};

// Sign condition keywords
const SIGN_CONDITION_KEYWORDS = {
  good: ['clear', 'visible', 'legible', 'readable'],
  faded: ['faded', 'worn', 'weathered', 'old'],
  damaged: ['damaged', 'broken', 'cracked', 'bent', 'vandalized'],
  obscured: ['obscured', 'blocked', 'covered', 'hidden', 'behind', 'tree', 'bush'],
  missing: ['missing', 'no sign', 'absent', 'none'],
};

interface AnalysisInput {
  ticket_id: string;
  user_id: string;
  evidence_type: EvidenceType;
  file_url?: string;
  file_name?: string;
  extracted_text?: string; // From OCR or user input
  violation_type?: string;
  ticket_date?: string;
}

/**
 * Analyze evidence and extract useful information
 */
export function analyzeEvidence(input: AnalysisInput): EvidenceAnalysisResult {
  const text = input.extracted_text || '';
  const textLower = text.toLowerCase();

  // Determine evidence category
  const category = categorizeEvidence(text, input.evidence_type, input.file_name);

  // Extract relevant data based on category
  const extractedData = extractDataFromText(text, category);

  // Calculate relevance and quality scores
  const relevanceScore = calculateRelevanceScore(category, extractedData, input.violation_type);
  const qualityScore = calculateQualityScore(text, input.evidence_type);

  // Check if evidence validates the defense
  const { validates, notes, summary } = validateDefense(
    category,
    extractedData,
    input.violation_type,
    input.ticket_date
  );

  // Create analysis object
  const analysis: EvidenceAnalysis = {
    id: '', // Will be set when saved
    ticket_id: input.ticket_id,
    user_id: input.user_id,
    evidence_type: input.evidence_type,
    file_url: input.file_url,
    file_name: input.file_name,
    extracted_text: text,
    extracted_data: extractedData,
    evidence_category: category,
    relevance_score: relevanceScore,
    quality_score: qualityScore,

    // Category-specific fields
    payment_app: extractedData.payment_app,
    payment_time: extractedData.payment_time,
    payment_zone: extractedData.payment_zone,
    payment_amount: extractedData.payment_amount,
    session_start: extractedData.session_start,
    session_end: extractedData.session_end,

    renewal_type: extractedData.renewal_type,
    renewal_date: extractedData.renewal_date,
    effective_date: extractedData.effective_date,
    confirmation_number: extractedData.confirmation_number,

    sign_readable: extractedData.sign_readable,
    sign_condition: extractedData.sign_condition,
    sign_obstruction: extractedData.sign_obstruction,

    validates_defense: validates,
    validation_notes: notes,
    analysis_summary: summary,

    analyzed_at: new Date().toISOString(),
  };

  // Calculate defense impact
  const defenseImpact = calculateDefenseImpact(analysis, input.violation_type);

  return {
    analysis,
    defense_impact: defenseImpact,
    warnings: generateWarnings(analysis, input.violation_type, input.ticket_date),
  };
}

/**
 * Categorize evidence based on content and type
 */
function categorizeEvidence(
  text: string,
  evidenceType: EvidenceType,
  fileName?: string
): EvidenceCategory {
  const textLower = text.toLowerCase();
  const fileNameLower = (fileName || '').toLowerCase();

  // Check for parking payment
  if (
    EXTRACTION_PATTERNS.parking_app.test(text) ||
    textLower.includes('parking session') ||
    textLower.includes('zone') && textLower.includes('paid') ||
    fileNameLower.includes('parkchicago') ||
    fileNameLower.includes('parking')
  ) {
    return 'parking_payment';
  }

  // Check for renewal proof
  if (
    textLower.includes('renewal') ||
    textLower.includes('city sticker') ||
    textLower.includes('vehicle sticker') ||
    textLower.includes('registration') ||
    textLower.includes('secretary of state') ||
    textLower.includes('confirmation') && (textLower.includes('sticker') || textLower.includes('plate'))
  ) {
    return 'renewal_proof';
  }

  // Check for signage photo
  if (
    textLower.includes('sign') ||
    textLower.includes('no parking') ||
    textLower.includes('street cleaning') ||
    textLower.includes('permit zone') ||
    fileNameLower.includes('sign')
  ) {
    return 'signage_photo';
  }

  // Check for meter photo
  if (
    textLower.includes('meter') ||
    textLower.includes('out of order') ||
    textLower.includes('malfunction') ||
    fileNameLower.includes('meter')
  ) {
    return 'meter_photo';
  }

  // Check for location proof
  if (
    EXTRACTION_PATTERNS.chicago_address.test(text) ||
    textLower.includes('parked') && textLower.includes('location') ||
    fileNameLower.includes('location') ||
    fileNameLower.includes('street')
  ) {
    return 'location_proof';
  }

  // Check for vehicle photo
  if (
    textLower.includes('vehicle') ||
    textLower.includes('car') ||
    textLower.includes('plate') ||
    fileNameLower.includes('car') ||
    fileNameLower.includes('vehicle')
  ) {
    return 'vehicle_photo';
  }

  return 'other';
}

/**
 * Extract data from text based on category
 */
function extractDataFromText(
  text: string,
  category: EvidenceCategory
): Record<string, any> {
  const data: Record<string, any> = {};

  // Extract parking payment data
  if (category === 'parking_payment') {
    const appMatch = text.match(EXTRACTION_PATTERNS.parking_app);
    if (appMatch) data.payment_app = appMatch[1];

    const zoneMatch = text.match(EXTRACTION_PATTERNS.parkchicago_zone);
    if (zoneMatch) data.payment_zone = zoneMatch[1];

    const amountMatch = text.match(EXTRACTION_PATTERNS.parking_amount) || text.match(EXTRACTION_PATTERNS.amount);
    if (amountMatch) data.payment_amount = parseFloat(amountMatch[1]);

    const startMatch = text.match(EXTRACTION_PATTERNS.parkchicago_time);
    if (startMatch) data.session_start = startMatch[1];

    const endMatch = text.match(EXTRACTION_PATTERNS.parkchicago_expiry);
    if (endMatch) data.session_end = endMatch[1];

    const sessionMatch = text.match(EXTRACTION_PATTERNS.parkchicago_session);
    if (sessionMatch) data.session_status = sessionMatch[1];
  }

  // Extract renewal data
  if (category === 'renewal_proof') {
    const confirmMatch = text.match(EXTRACTION_PATTERNS.confirmation_number);
    if (confirmMatch) data.confirmation_number = confirmMatch[1];

    const renewalMatch = text.match(EXTRACTION_PATTERNS.renewal_date);
    if (renewalMatch) data.renewal_date = renewalMatch[1];

    const expiryMatch = text.match(EXTRACTION_PATTERNS.expiration_date);
    if (expiryMatch) data.effective_date = expiryMatch[1];

    // Determine renewal type
    const textLower = text.toLowerCase();
    if (textLower.includes('city sticker') || textLower.includes('vehicle sticker')) {
      data.renewal_type = 'city_sticker';
    } else if (textLower.includes('registration') || textLower.includes('plate')) {
      data.renewal_type = 'registration';
    } else if (textLower.includes('permit')) {
      data.renewal_type = 'permit';
    }
  }

  // Extract signage data
  if (category === 'signage_photo') {
    const textLower = text.toLowerCase();

    // Determine sign condition
    for (const [condition, keywords] of Object.entries(SIGN_CONDITION_KEYWORDS)) {
      if (keywords.some(kw => textLower.includes(kw))) {
        data.sign_condition = condition;
        break;
      }
    }

    // Check readability
    data.sign_readable = !['faded', 'damaged', 'obscured', 'missing'].includes(data.sign_condition);

    // Check for obstruction
    if (textLower.includes('tree') || textLower.includes('bush')) {
      data.sign_obstruction = 'vegetation';
    } else if (textLower.includes('car') || textLower.includes('vehicle')) {
      data.sign_obstruction = 'vehicle';
    } else if (textLower.includes('snow') || textLower.includes('ice')) {
      data.sign_obstruction = 'weather';
    }
  }

  // Extract general date/time
  const dateMatch = text.match(EXTRACTION_PATTERNS.date_mdy) || text.match(EXTRACTION_PATTERNS.date_written);
  if (dateMatch) data.extracted_date = dateMatch[0];

  const timeMatch = text.match(EXTRACTION_PATTERNS.time_12h) || text.match(EXTRACTION_PATTERNS.time_24h);
  if (timeMatch) data.extracted_time = timeMatch[0];

  return data;
}

/**
 * Calculate relevance score (0-1)
 */
function calculateRelevanceScore(
  category: EvidenceCategory,
  extractedData: Record<string, any>,
  violationType?: string
): number {
  let score = 0.3; // Base relevance

  // Category-violation match bonuses
  const categoryMatches: Record<string, string[]> = {
    parking_payment: ['expired_meter'],
    renewal_proof: ['expired_plates', 'no_city_sticker', 'residential_permit'],
    signage_photo: ['street_cleaning', 'no_standing_time_restricted', 'residential_permit'],
    meter_photo: ['expired_meter'],
    location_proof: ['fire_hydrant', 'bus_stop', 'bike_lane', 'double_parking'],
    vehicle_photo: ['missing_plate', 'disabled_zone'],
  };

  if (violationType && categoryMatches[category]?.includes(violationType)) {
    score += 0.4;
  }

  // Bonus for extracted data
  const dataCount = Object.keys(extractedData).filter(k => extractedData[k] !== undefined).length;
  score += Math.min(dataCount * 0.05, 0.3);

  return Math.min(1, score);
}

/**
 * Calculate quality score (0-1)
 */
function calculateQualityScore(text: string, evidenceType: EvidenceType): number {
  let score = 0.5; // Base quality

  // Text length (more context is generally better)
  if (text.length > 100) score += 0.1;
  if (text.length > 300) score += 0.1;
  if (text.length > 500) score += 0.1;

  // Presence of key identifiers
  if (EXTRACTION_PATTERNS.confirmation_number.test(text)) score += 0.1;
  if (EXTRACTION_PATTERNS.date_mdy.test(text) || EXTRACTION_PATTERNS.date_written.test(text)) score += 0.1;
  if (EXTRACTION_PATTERNS.amount.test(text)) score += 0.05;

  return Math.min(1, score);
}

/**
 * Validate if evidence supports the defense
 */
function validateDefense(
  category: EvidenceCategory,
  extractedData: Record<string, any>,
  violationType?: string,
  ticketDate?: string
): { validates: boolean; notes: string; summary: string } {
  let validates = false;
  let notes = '';
  let summary = '';

  if (category === 'parking_payment' && violationType === 'expired_meter') {
    if (extractedData.session_status === 'active') {
      validates = true;
      notes = 'Parking session was active at time of ticket';
      summary = `Payment proof shows active session${extractedData.payment_zone ? ` in zone ${extractedData.payment_zone}` : ''}. This is strong evidence the meter was paid.`;
    } else if (extractedData.payment_app) {
      validates = true;
      notes = 'Payment app receipt found - need to verify timing';
      summary = `Found ${extractedData.payment_app} payment. Verify the session time matches the ticket time.`;
    }
  }

  if (category === 'renewal_proof' && ['expired_plates', 'no_city_sticker'].includes(violationType || '')) {
    if (extractedData.renewal_date || extractedData.confirmation_number) {
      // Would need to compare dates in production
      validates = true;
      notes = 'Renewal proof found - need to verify dates';
      summary = `Found ${extractedData.renewal_type || 'renewal'} confirmation${extractedData.confirmation_number ? ` #${extractedData.confirmation_number}` : ''}. Strong evidence if renewal date was before the ticket.`;
    }
  }

  if (category === 'signage_photo') {
    if (extractedData.sign_condition === 'missing') {
      validates = true;
      notes = 'Sign reported as missing';
      summary = 'Evidence suggests the required sign was missing. This is a strong defense.';
    } else if (extractedData.sign_condition === 'obscured' || extractedData.sign_obstruction) {
      validates = true;
      notes = `Sign was obscured by ${extractedData.sign_obstruction || 'obstruction'}`;
      summary = `Sign was obscured${extractedData.sign_obstruction ? ` by ${extractedData.sign_obstruction}` : ''}. This can support a signage defense.`;
    } else if (extractedData.sign_condition === 'faded' || extractedData.sign_condition === 'damaged') {
      validates = true;
      notes = `Sign was ${extractedData.sign_condition}`;
      summary = `Sign was ${extractedData.sign_condition}, potentially making it difficult to read. This may support your defense.`;
    }
  }

  if (!validates && Object.keys(extractedData).length > 0) {
    notes = 'Evidence received but needs manual verification';
    summary = 'We received your evidence and will incorporate it into your defense.';
  }

  return { validates, notes, summary };
}

/**
 * Calculate defense impact
 */
function calculateDefenseImpact(
  analysis: EvidenceAnalysis,
  violationType?: string
): { strengthens_case: boolean; impact_score: number; suggested_use: string } {
  let strengthens = analysis.validates_defense;
  let impactScore = analysis.relevance_score * analysis.quality_score;

  // Category-specific impact
  if (analysis.evidence_category === 'parking_payment' && violationType === 'expired_meter') {
    impactScore = Math.max(impactScore, 0.8);
    strengthens = true;
  }

  if (analysis.evidence_category === 'renewal_proof' &&
      ['expired_plates', 'no_city_sticker'].includes(violationType || '')) {
    impactScore = Math.max(impactScore, 0.8);
    strengthens = true;
  }

  // Generate suggested use
  let suggestedUse = 'Include as supporting evidence';
  if (impactScore > 0.7) {
    suggestedUse = 'Use as primary evidence - reference prominently in letter';
  } else if (impactScore > 0.5) {
    suggestedUse = 'Include as supporting documentation';
  } else if (impactScore < 0.3) {
    suggestedUse = 'May have limited impact - consider gathering additional evidence';
  }

  return { strengthens_case: strengthens, impact_score: impactScore, suggested_use: suggestedUse };
}

/**
 * Generate warnings about the evidence
 */
function generateWarnings(
  analysis: EvidenceAnalysis,
  violationType?: string,
  ticketDate?: string
): string[] {
  const warnings: string[] = [];

  // Date mismatch warnings
  if (analysis.extracted_data?.renewal_date && ticketDate) {
    // In production, compare dates properly
    warnings.push('Please verify the renewal date was BEFORE the ticket date');
  }

  // Payment time warnings
  if (analysis.evidence_category === 'parking_payment' && !analysis.extracted_data?.session_start) {
    warnings.push('Unable to extract payment start time - please verify manually');
  }

  // Zone mismatch potential
  if (analysis.payment_zone) {
    warnings.push('Make sure the payment zone matches the ticket location');
  }

  // Weak evidence warnings
  if (analysis.relevance_score < 0.4) {
    warnings.push('This evidence may have limited impact on your case');
  }

  return warnings;
}

/**
 * Save evidence analysis to database
 */
export async function saveEvidenceAnalysis(
  supabase: ReturnType<typeof createClient>,
  analysis: EvidenceAnalysis
): Promise<string> {
  const { data, error } = await supabase
    .from('evidence_analysis')
    .insert({
      ticket_id: analysis.ticket_id,
      user_id: analysis.user_id,
      evidence_type: analysis.evidence_type,
      file_url: analysis.file_url,
      file_name: analysis.file_name,
      extracted_text: analysis.extracted_text,
      extracted_data: analysis.extracted_data,
      evidence_category: analysis.evidence_category,
      relevance_score: analysis.relevance_score,
      quality_score: analysis.quality_score,
      payment_app: analysis.payment_app,
      payment_time: analysis.payment_time,
      payment_zone: analysis.payment_zone,
      payment_amount: analysis.payment_amount,
      session_start: analysis.session_start,
      session_end: analysis.session_end,
      renewal_type: analysis.renewal_type,
      renewal_date: analysis.renewal_date,
      effective_date: analysis.effective_date,
      confirmation_number: analysis.confirmation_number,
      sign_readable: analysis.sign_readable,
      sign_condition: analysis.sign_condition,
      sign_obstruction: analysis.sign_obstruction,
      validates_defense: analysis.validates_defense,
      validation_notes: analysis.validation_notes,
      analysis_summary: analysis.analysis_summary,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save evidence analysis: ${error.message}`);
  }

  return data.id;
}

/**
 * Get all evidence analyses for a ticket
 */
export async function getTicketEvidenceAnalyses(
  supabase: ReturnType<typeof createClient>,
  ticketId: string
): Promise<EvidenceAnalysis[]> {
  const { data, error } = await supabase
    .from('evidence_analysis')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('analyzed_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get evidence analyses: ${error.message}`);
  }

  return data as EvidenceAnalysis[];
}

export { EXTRACTION_PATTERNS, SIGN_CONDITION_KEYWORDS };
