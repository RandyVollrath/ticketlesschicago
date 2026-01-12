/**
 * Property Tax Appeal Analysis Engine
 *
 * Implements a two-track analysis system:
 * 1. Market Value (MV) Case - Assessment exceeds predicted market value
 * 2. Uniformity (UNI) Case - Assessment is non-uniform vs similar properties
 *
 * Also includes:
 * - Comparable quality scoring and audit trails
 * - Conservative adjustment calculations
 * - Win-rate protection gates
 * - No-appeal explanation generator
 */

import {
  NormalizedProperty,
  ComparableProperty,
  ComparableSale,
  AppealOpportunity
} from './cook-county-api';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** Market Value Case Analysis */
export interface MVCaseAnalysis {
  /** Strength of the market value case */
  caseStrength: 'strong' | 'moderate' | 'weak';
  /** Target assessed value based on market data */
  targetAssessedValue: number;
  /** Current assessed value */
  currentAssessedValue: number;
  /** Potential reduction */
  potentialReduction: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Methodology used */
  methodology: 'sales_comparison' | 'median_assessment' | 'regression';
  /** Bullet points for rationale */
  rationale: string[];
  /** Supporting data */
  supportingData: {
    /** Median sale price of comparables (if available) */
    medianSalePrice: number | null;
    /** Median $/sqft from sales */
    medianSalePricePerSqft: number | null;
    /** Implied market value based on sales */
    impliedMarketValue: number | null;
    /** Assessment level (assessed / market) */
    assessmentLevel: number | null;
    /** Sales count used */
    salesCount: number;
  };
  /** Risk flags */
  riskFlags: string[];
}

/** Uniformity Case Analysis */
export interface UNICaseAnalysis {
  /** Strength of the uniformity case */
  caseStrength: 'strong' | 'moderate' | 'weak';
  /** Target assessed value based on uniformity (e.g., 50th or 60th percentile) */
  targetAssessedValue: number;
  /** Current assessed value */
  currentAssessedValue: number;
  /** Potential reduction */
  potentialReduction: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Target percentile used (typically 50 or 60) */
  targetPercentile: number;
  /** Bullet points for rationale */
  rationale: string[];
  /** Supporting data */
  supportingData: {
    /** Subject's current percentile rank (100 = highest assessed) */
    currentPercentileRank: number;
    /** Coefficient of Dispersion - measures uniformity */
    coefficientOfDispersion: number;
    /** Number of comparables in pool */
    comparablePoolSize: number;
    /** Count of properties assessed lower than subject */
    propertiesAssessedLower: number;
    /** Median $/sqft among comparables */
    medianValuePerSqft: number;
    /** Subject's $/sqft */
    subjectValuePerSqft: number;
    /** Value at target percentile */
    valueAtTargetPercentile: number;
  };
  /** Risk flags */
  riskFlags: string[];
}

/** Comparable Quality Score and Audit */
export interface ComparableQualityAudit {
  /** Overall quality score (0-100) */
  qualityScore: number;
  /** Individual comparable audits */
  comparableAudits: ComparableAuditItem[];
  /** Aggregate quality assessment */
  aggregateAssessment: 'excellent' | 'good' | 'acceptable' | 'poor';
  /** Reasons for score */
  scoreBreakdown: {
    distanceScore: number;      // 0-20
    neighborhoodBonus: number;  // 0-25
    sqftPenalty: number;        // 0-15
    bedroomPenalty: number;     // 0-10
    recencyScore: number;       // 0-15
    missingDataPenalty: number; // 0-15
  };
}

/** Individual comparable audit item */
export interface ComparableAuditItem {
  pin: string;
  pinFormatted: string;
  address: string;
  /** Individual quality score for this comp */
  qualityScore: number;
  /** Why this comparable was included */
  whyIncluded: string[];
  /** Key differences from subject */
  keyDeltas: {
    field: string;
    subjectValue: string | number | null;
    compValue: string | number | null;
    impact: 'favorable' | 'neutral' | 'unfavorable';
  }[];
  /** Penalties applied */
  penaltiesApplied: {
    penalty: string;
    points: number;
    reason: string;
  }[];
  /** Adjustments applied (if any) */
  adjustments: ComparableAdjustment[];
  /** Adjusted value after adjustments */
  adjustedValue: number | null;
}

/** Conservative adjustment for a comparable */
export interface ComparableAdjustment {
  type: 'size' | 'bedrooms' | 'bathrooms' | 'parking' | 'floor' | 'age' | 'condition';
  adjustmentDollars: number;
  adjustmentPercent: number;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Final appeal strategy decision */
export interface AppealStrategyDecision {
  /** Recommended strategy */
  strategy: 'file_mv' | 'file_uni' | 'file_both' | 'do_not_file';
  /** Human-readable reasons for this decision */
  reasons: string[];
  /** Which case is primary (if filing) */
  primaryCase: 'mv' | 'uni' | null;
  /** Estimated tax savings per year */
  estimatedSavings: number;
  /** Target assessed value to request */
  targetAssessedValue: number;
  /** Risk flags that should be disclosed */
  riskFlags: string[];
  /** Gate triggers that affected decision */
  gatesTrigered: string[];
  /** Overall case confidence */
  overallConfidence: number;
  /** Professional appeal summary */
  appealSummary: string;
}

/** No-appeal explanation for user */
export interface NoAppealExplanation {
  /** Primary reason in one sentence */
  primaryReason: string;
  /** Top 3 factors contributing to this decision */
  topFactors: string[];
  /** What would need to change for a future appeal */
  whatWouldChange: string[];
  /** Monitoring message */
  monitoringMessage: string;
  /** Whether to add to watchlist */
  recommendWatchlist: boolean;
}

/** Complete analysis result */
export interface PropertyTaxAnalysisResult {
  /** Market Value case analysis */
  mvCase: MVCaseAnalysis;
  /** Uniformity case analysis */
  uniCase: UNICaseAnalysis;
  /** Comparable quality audit */
  comparableQuality: ComparableQualityAudit;
  /** Final strategy decision */
  strategyDecision: AppealStrategyDecision;
  /** No-appeal explanation (if applicable) */
  noAppealExplanation: NoAppealExplanation | null;
  /** Raw data used */
  rawData: {
    subject: NormalizedProperty;
    comparables: ComparableProperty[];
    sales: ComparableSale[];
  };
}

// =============================================================================
// COMPARABLE QUALITY SCORING
// =============================================================================

/**
 * Score an individual comparable against the subject property
 */
export function scoreComparable(
  comp: ComparableProperty,
  subject: NormalizedProperty
): { score: number; audit: ComparableAuditItem } {
  let score = 100;
  const penalties: ComparableAuditItem['penaltiesApplied'] = [];
  const keyDeltas: ComparableAuditItem['keyDeltas'] = [];
  const whyIncluded: string[] = [];

  // 1. Distance scoring (0-20 points penalty)
  const distanceMiles = comp.distanceMiles ?? 10;
  let distancePenalty = 0;
  if (distanceMiles > 5) {
    distancePenalty = 20;
    penalties.push({ penalty: 'distance', points: 20, reason: `More than 5 miles away (${distanceMiles.toFixed(1)} mi)` });
  } else if (distanceMiles > 2) {
    distancePenalty = 10;
    penalties.push({ penalty: 'distance', points: 10, reason: `2-5 miles away (${distanceMiles.toFixed(1)} mi)` });
  } else if (distanceMiles > 1) {
    distancePenalty = 5;
    penalties.push({ penalty: 'distance', points: 5, reason: `1-2 miles away (${distanceMiles.toFixed(1)} mi)` });
  } else {
    whyIncluded.push(`Close proximity (${distanceMiles.toFixed(2)} mi)`);
  }
  score -= distancePenalty;

  // 2. Same neighborhood/building bonus (0-25 points bonus)
  let neighborhoodBonus = 0;
  if (comp.neighborhood === subject.neighborhood) {
    neighborhoodBonus = 15;
    whyIncluded.push('Same assessment neighborhood');
  }
  // Check for same building (condos - same first 10 digits of PIN)
  if (subject.pin.slice(0, 10) === comp.pin.slice(0, 10)) {
    neighborhoodBonus = 25;
    whyIncluded.push('Same building');
  }
  score += neighborhoodBonus;

  // 3. Square footage delta penalty (0-15 points)
  let sqftPenalty = 0;
  if (subject.squareFootage && comp.squareFootage) {
    const sqftDelta = Math.abs(comp.squareFootage - subject.squareFootage) / subject.squareFootage;
    keyDeltas.push({
      field: 'Square Footage',
      subjectValue: subject.squareFootage,
      compValue: comp.squareFootage,
      impact: sqftDelta > 0.2 ? 'unfavorable' : 'neutral'
    });
    if (sqftDelta > 0.5) {
      sqftPenalty = 15;
      penalties.push({ penalty: 'sqft_delta', points: 15, reason: `Size differs by ${(sqftDelta * 100).toFixed(0)}%` });
    } else if (sqftDelta > 0.3) {
      sqftPenalty = 10;
      penalties.push({ penalty: 'sqft_delta', points: 10, reason: `Size differs by ${(sqftDelta * 100).toFixed(0)}%` });
    } else if (sqftDelta > 0.15) {
      sqftPenalty = 5;
      penalties.push({ penalty: 'sqft_delta', points: 5, reason: `Size differs by ${(sqftDelta * 100).toFixed(0)}%` });
    } else {
      whyIncluded.push(`Similar size (${(sqftDelta * 100).toFixed(0)}% difference)`);
    }
  } else {
    sqftPenalty = 10; // Missing data
    penalties.push({ penalty: 'missing_sqft', points: 10, reason: 'Square footage data missing' });
  }
  score -= sqftPenalty;

  // 4. Bedroom/bathroom mismatch (0-10 points)
  let bedroomPenalty = 0;
  if (subject.bedrooms !== null && comp.bedrooms !== null) {
    const bedroomDelta = Math.abs(comp.bedrooms - subject.bedrooms);
    keyDeltas.push({
      field: 'Bedrooms',
      subjectValue: subject.bedrooms,
      compValue: comp.bedrooms,
      impact: bedroomDelta > 1 ? 'unfavorable' : 'neutral'
    });
    if (bedroomDelta > 2) {
      bedroomPenalty = 10;
      penalties.push({ penalty: 'bedroom_mismatch', points: 10, reason: `${bedroomDelta} bedroom difference` });
    } else if (bedroomDelta > 1) {
      bedroomPenalty = 5;
      penalties.push({ penalty: 'bedroom_mismatch', points: 5, reason: `${bedroomDelta} bedroom difference` });
    } else {
      whyIncluded.push(`Similar bedroom count`);
    }
  }
  score -= bedroomPenalty;

  // 5. Recency (for sales) - 0-15 points
  let recencyPenalty = 0;
  if (comp.saleDate) {
    const saleDate = new Date(comp.saleDate);
    const monthsAgo = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    keyDeltas.push({
      field: 'Sale Date',
      subjectValue: 'N/A',
      compValue: comp.saleDate,
      impact: monthsAgo > 24 ? 'unfavorable' : 'neutral'
    });
    if (monthsAgo > 36) {
      recencyPenalty = 15;
      penalties.push({ penalty: 'stale_sale', points: 15, reason: `Sale over 3 years old` });
    } else if (monthsAgo > 24) {
      recencyPenalty = 10;
      penalties.push({ penalty: 'stale_sale', points: 10, reason: `Sale 2-3 years old` });
    } else if (monthsAgo > 12) {
      recencyPenalty = 5;
      penalties.push({ penalty: 'stale_sale', points: 5, reason: `Sale 1-2 years old` });
    } else {
      whyIncluded.push(`Recent sale (${Math.round(monthsAgo)} months ago)`);
    }
  }
  score -= recencyPenalty;

  // 6. Missing data penalty (0-15 points)
  let missingDataPenalty = 0;
  const missingFields: string[] = [];
  if (!comp.squareFootage) missingFields.push('sqft');
  if (!comp.bedrooms) missingFields.push('bedrooms');
  if (!comp.yearBuilt) missingFields.push('year built');
  if (!comp.assessedValue) missingFields.push('assessed value');

  if (missingFields.length >= 3) {
    missingDataPenalty = 15;
    penalties.push({ penalty: 'missing_data', points: 15, reason: `Missing: ${missingFields.join(', ')}` });
  } else if (missingFields.length >= 2) {
    missingDataPenalty = 10;
    penalties.push({ penalty: 'missing_data', points: 10, reason: `Missing: ${missingFields.join(', ')}` });
  } else if (missingFields.length === 1) {
    missingDataPenalty = 5;
    penalties.push({ penalty: 'missing_data', points: 5, reason: `Missing: ${missingFields.join(', ')}` });
  }
  score -= missingDataPenalty;

  // Year built comparison
  if (subject.yearBuilt && comp.yearBuilt) {
    const ageDelta = Math.abs(comp.yearBuilt - subject.yearBuilt);
    keyDeltas.push({
      field: 'Year Built',
      subjectValue: subject.yearBuilt,
      compValue: comp.yearBuilt,
      impact: ageDelta > 20 ? 'unfavorable' : 'neutral'
    });
    if (ageDelta <= 10) {
      whyIncluded.push('Similar age');
    }
  }

  // Property class match
  if (comp.propertyClass === subject.propertyClass) {
    whyIncluded.push('Same property class');
  }

  // Ensure score stays in bounds
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    audit: {
      pin: comp.pin,
      pinFormatted: comp.pinFormatted,
      address: comp.address,
      qualityScore: score,
      whyIncluded,
      keyDeltas,
      penaltiesApplied: penalties,
      adjustments: [],
      adjustedValue: null
    }
  };
}

/**
 * Score an entire set of comparables
 */
export function scoreComparableSet(
  comparables: ComparableProperty[],
  subject: NormalizedProperty
): ComparableQualityAudit {
  const audits: ComparableAuditItem[] = [];
  let totalScore = 0;
  let distanceTotal = 0;
  let neighborhoodBonusTotal = 0;
  let sqftPenaltyTotal = 0;
  let bedroomPenaltyTotal = 0;
  let recencyTotal = 0;
  let missingDataTotal = 0;

  for (const comp of comparables) {
    const { score, audit } = scoreComparable(comp, subject);
    audits.push(audit);
    totalScore += score;

    // Aggregate breakdowns
    for (const penalty of audit.penaltiesApplied) {
      switch (penalty.penalty) {
        case 'distance':
          distanceTotal += penalty.points;
          break;
        case 'sqft_delta':
        case 'missing_sqft':
          sqftPenaltyTotal += penalty.points;
          break;
        case 'bedroom_mismatch':
          bedroomPenaltyTotal += penalty.points;
          break;
        case 'stale_sale':
          recencyTotal += penalty.points;
          break;
        case 'missing_data':
          missingDataTotal += penalty.points;
          break;
      }
    }

    // Neighborhood bonus is positive, so check whyIncluded
    if (audit.whyIncluded.includes('Same building')) {
      neighborhoodBonusTotal += 25;
    } else if (audit.whyIncluded.includes('Same assessment neighborhood')) {
      neighborhoodBonusTotal += 15;
    }
  }

  const avgScore = comparables.length > 0 ? totalScore / comparables.length : 0;
  const count = comparables.length || 1;

  let aggregateAssessment: ComparableQualityAudit['aggregateAssessment'];
  if (avgScore >= 80) {
    aggregateAssessment = 'excellent';
  } else if (avgScore >= 65) {
    aggregateAssessment = 'good';
  } else if (avgScore >= 50) {
    aggregateAssessment = 'acceptable';
  } else {
    aggregateAssessment = 'poor';
  }

  return {
    qualityScore: Math.round(avgScore),
    comparableAudits: audits,
    aggregateAssessment,
    scoreBreakdown: {
      distanceScore: 20 - Math.round(distanceTotal / count),
      neighborhoodBonus: Math.round(neighborhoodBonusTotal / count),
      sqftPenalty: Math.round(sqftPenaltyTotal / count),
      bedroomPenalty: Math.round(bedroomPenaltyTotal / count),
      recencyScore: 15 - Math.round(recencyTotal / count),
      missingDataPenalty: Math.round(missingDataTotal / count)
    }
  };
}

// =============================================================================
// CONSERVATIVE ADJUSTMENTS
// =============================================================================

/**
 * Calculate conservative adjustments for a comparable
 * Caps total adjustments at ±10% unless confidence is high
 */
export function estimateAdjustedValue(
  comp: ComparableProperty,
  subject: NormalizedProperty
): { rawValue: number; adjustedValue: number; adjustments: ComparableAdjustment[] } {
  const rawValue = comp.assessedValue || 0;
  const adjustments: ComparableAdjustment[] = [];
  let totalAdjustment = 0;
  let highConfidenceAdjustments = true;

  // 1. Size adjustment via $/sqft (most reliable)
  if (comp.squareFootage && subject.squareFootage && comp.valuePerSqft) {
    const sqftDiff = subject.squareFootage - comp.squareFootage;
    const sizeAdjustment = sqftDiff * comp.valuePerSqft;

    adjustments.push({
      type: 'size',
      adjustmentDollars: Math.round(sizeAdjustment),
      adjustmentPercent: rawValue > 0 ? (sizeAdjustment / rawValue) * 100 : 0,
      explanation: `Size adjustment: Subject is ${sqftDiff > 0 ? 'larger' : 'smaller'} by ${Math.abs(sqftDiff)} sqft at $${comp.valuePerSqft?.toFixed(2)}/sqft`,
      confidence: 'high'
    });
    totalAdjustment += sizeAdjustment;
  } else {
    highConfidenceAdjustments = false;
  }

  // 2. Bedroom adjustment (flat delta)
  const BEDROOM_ADJUSTMENT = 5000; // Conservative $5k per bedroom
  if (subject.bedrooms !== null && comp.bedrooms !== null) {
    const bedroomDiff = subject.bedrooms - comp.bedrooms;
    if (bedroomDiff !== 0) {
      const bedroomAdj = bedroomDiff * BEDROOM_ADJUSTMENT;
      adjustments.push({
        type: 'bedrooms',
        adjustmentDollars: bedroomAdj,
        adjustmentPercent: rawValue > 0 ? (bedroomAdj / rawValue) * 100 : 0,
        explanation: `Bedroom adjustment: Subject has ${bedroomDiff > 0 ? 'more' : 'fewer'} bedrooms (${Math.abs(bedroomDiff)} @ $${BEDROOM_ADJUSTMENT.toLocaleString()}/bedroom)`,
        confidence: 'medium'
      });
      totalAdjustment += bedroomAdj;
    }
  }

  // 3. Bathroom adjustment (flat delta)
  const BATHROOM_ADJUSTMENT = 3000; // Conservative $3k per bathroom
  if (subject.bathrooms !== null && comp.bathrooms !== null) {
    const bathDiff = subject.bathrooms - comp.bathrooms;
    if (bathDiff !== 0) {
      const bathAdj = bathDiff * BATHROOM_ADJUSTMENT;
      adjustments.push({
        type: 'bathrooms',
        adjustmentDollars: bathAdj,
        adjustmentPercent: rawValue > 0 ? (bathAdj / rawValue) * 100 : 0,
        explanation: `Bathroom adjustment: Subject has ${bathDiff > 0 ? 'more' : 'fewer'} bathrooms (${Math.abs(bathDiff)} @ $${BATHROOM_ADJUSTMENT.toLocaleString()}/bathroom)`,
        confidence: 'medium'
      });
      totalAdjustment += bathAdj;
    }
  }

  // 4. Age adjustment
  const AGE_ADJUSTMENT_PER_YEAR = 200; // Very conservative $200/year
  if (subject.yearBuilt && comp.yearBuilt) {
    const ageDiff = comp.yearBuilt - subject.yearBuilt; // Positive if comp is newer
    if (Math.abs(ageDiff) > 5) {
      const ageAdj = ageDiff * AGE_ADJUSTMENT_PER_YEAR;
      adjustments.push({
        type: 'age',
        adjustmentDollars: ageAdj,
        adjustmentPercent: rawValue > 0 ? (ageAdj / rawValue) * 100 : 0,
        explanation: `Age adjustment: Comp is ${ageDiff > 0 ? 'newer' : 'older'} by ${Math.abs(ageDiff)} years`,
        confidence: 'low'
      });
      totalAdjustment += ageAdj;
      highConfidenceAdjustments = false;
    }
  }

  // Cap total adjustments at ±10% unless all high confidence
  const maxAdjustmentPercent = highConfidenceAdjustments ? 0.15 : 0.10;
  const maxAdjustment = rawValue * maxAdjustmentPercent;

  if (Math.abs(totalAdjustment) > maxAdjustment) {
    const cappedAdjustment = Math.sign(totalAdjustment) * maxAdjustment;
    adjustments.push({
      type: 'condition',
      adjustmentDollars: cappedAdjustment - totalAdjustment,
      adjustmentPercent: rawValue > 0 ? ((cappedAdjustment - totalAdjustment) / rawValue) * 100 : 0,
      explanation: `Adjustment cap applied: Limited total adjustments to ±${maxAdjustmentPercent * 100}%`,
      confidence: 'high'
    });
    totalAdjustment = cappedAdjustment;
  }

  return {
    rawValue,
    adjustedValue: Math.round(rawValue + totalAdjustment),
    adjustments
  };
}

// =============================================================================
// MARKET VALUE (MV) CASE ANALYZER
// =============================================================================

/**
 * Analyze Market Value case - whether assessment exceeds market value
 */
export function analyzeMVCase(
  subject: NormalizedProperty,
  comparables: ComparableProperty[],
  sales: ComparableSale[],
  compQuality: ComparableQualityAudit
): MVCaseAnalysis {
  const rationale: string[] = [];
  const riskFlags: string[] = [];

  const currentAssessedValue = subject.assessedValue || 0;
  const subjectSqft = subject.squareFootage || 0;

  // Calculate implied market value from sales if available
  let impliedMarketValue: number | null = null;
  let medianSalePrice: number | null = null;
  let medianSalePricePerSqft: number | null = null;

  const validSales = sales.filter(s => s.salePrice > 10000);

  if (validSales.length >= 3) {
    // Use median sale price
    const prices = validSales.map(s => s.salePrice).sort((a, b) => a - b);
    medianSalePrice = prices[Math.floor(prices.length / 2)];

    // Calculate $/sqft from sales
    const pricesPerSqft = validSales
      .filter(s => s.squareFootage && s.squareFootage > 0)
      .map(s => s.salePrice / (s.squareFootage || 1))
      .sort((a, b) => a - b);

    if (pricesPerSqft.length >= 2) {
      medianSalePricePerSqft = pricesPerSqft[Math.floor(pricesPerSqft.length / 2)];
      impliedMarketValue = subjectSqft > 0
        ? medianSalePricePerSqft * subjectSqft
        : medianSalePrice;

      rationale.push(`Based on ${validSales.length} comparable sales with median price of $${medianSalePrice?.toLocaleString()}`);
      rationale.push(`Median sale price per sqft: $${medianSalePricePerSqft?.toFixed(2)}`);
    }
  }

  // If no sales, use assessment comparisons
  const validComps = comparables.filter(c => c.assessedValue && c.assessedValue > 0);
  let targetAssessedValue = currentAssessedValue;
  let methodology: MVCaseAnalysis['methodology'] = 'median_assessment';

  if (impliedMarketValue) {
    // Cook County assesses at 10% of market value for residential
    const assessmentRatio = 0.10;
    targetAssessedValue = Math.round(impliedMarketValue * assessmentRatio);
    methodology = 'sales_comparison';
    rationale.push(`Implied assessed value based on market: $${targetAssessedValue.toLocaleString()}`);
  } else if (validComps.length >= 3) {
    // Use median comparable assessment
    const values = validComps.map(c => c.assessedValue!).sort((a, b) => a - b);
    const medianAssessment = values[Math.floor(values.length / 2)];

    // Adjust for size differences
    const valuePerSqft = validComps
      .filter(c => c.squareFootage && c.squareFootage > 0)
      .map(c => c.assessedValue! / c.squareFootage!);

    if (valuePerSqft.length >= 2 && subjectSqft > 0) {
      const medianPerSqft = valuePerSqft.sort((a, b) => a - b)[Math.floor(valuePerSqft.length / 2)];
      targetAssessedValue = Math.round(medianPerSqft * subjectSqft);
      rationale.push(`Based on ${validComps.length} comparable assessments`);
      rationale.push(`Median assessed value per sqft: $${medianPerSqft.toFixed(2)}`);
    } else {
      targetAssessedValue = medianAssessment;
      rationale.push(`Based on median of ${validComps.length} comparable assessments`);
    }
  } else {
    riskFlags.push('Insufficient comparable data for reliable market value estimate');
  }

  const potentialReduction = currentAssessedValue - targetAssessedValue;
  const reductionPercent = currentAssessedValue > 0
    ? (potentialReduction / currentAssessedValue) * 100
    : 0;

  // Calculate assessment level if we have market data
  let assessmentLevel: number | null = null;
  if (impliedMarketValue && impliedMarketValue > 0) {
    assessmentLevel = currentAssessedValue / impliedMarketValue;
    if (assessmentLevel > 0.12) {
      rationale.push(`Property assessed at ${(assessmentLevel * 100).toFixed(1)}% of market value (target: 10%)`);
    }
  }

  // Determine case strength
  let caseStrength: MVCaseAnalysis['caseStrength'];
  let confidence: number;

  if (validSales.length >= 5 && reductionPercent >= 15) {
    caseStrength = 'strong';
    confidence = 0.85;
    rationale.push(`Strong evidence of overassessment: ${reductionPercent.toFixed(1)}% above market-indicated value`);
  } else if ((validSales.length >= 3 || validComps.length >= 5) && reductionPercent >= 10) {
    caseStrength = 'moderate';
    confidence = 0.65;
    rationale.push(`Moderate evidence of overassessment: ${reductionPercent.toFixed(1)}% above comparable values`);
  } else {
    caseStrength = 'weak';
    confidence = 0.35;
    if (reductionPercent < 5) {
      rationale.push(`Assessment appears within reasonable range of market value`);
    } else {
      rationale.push(`Insufficient evidence to support significant reduction`);
    }
  }

  // Apply quality gate
  if (compQuality.qualityScore < 60) {
    if (caseStrength === 'strong') {
      caseStrength = 'moderate';
      confidence *= 0.7;
    }
    riskFlags.push('Comparable quality below threshold - case strength limited');
  }

  return {
    caseStrength,
    targetAssessedValue,
    currentAssessedValue,
    potentialReduction: Math.max(0, potentialReduction),
    confidence,
    methodology,
    rationale,
    supportingData: {
      medianSalePrice,
      medianSalePricePerSqft,
      impliedMarketValue,
      assessmentLevel,
      salesCount: validSales.length
    },
    riskFlags
  };
}

// =============================================================================
// UNIFORMITY (UNI) CASE ANALYZER
// =============================================================================

/**
 * Analyze Uniformity case - whether assessment is non-uniform vs peers
 */
export function analyzeUNICase(
  subject: NormalizedProperty,
  comparables: ComparableProperty[],
  compQuality: ComparableQualityAudit,
  targetPercentile: number = 50
): UNICaseAnalysis {
  const rationale: string[] = [];
  const riskFlags: string[] = [];

  const currentAssessedValue = subject.assessedValue || 0;
  const subjectSqft = subject.squareFootage || 0;

  // Filter valid comparables
  const validComps = comparables.filter(c =>
    c.assessedValue && c.assessedValue > 0 &&
    c.squareFootage && c.squareFootage > 0
  );

  if (validComps.length < 3) {
    riskFlags.push('Insufficient comparable data for uniformity analysis');
    return {
      caseStrength: 'weak',
      targetAssessedValue: currentAssessedValue,
      currentAssessedValue,
      potentialReduction: 0,
      confidence: 0.2,
      targetPercentile,
      rationale: ['Insufficient comparable properties for uniformity analysis'],
      supportingData: {
        currentPercentileRank: 50,
        coefficientOfDispersion: 0,
        comparablePoolSize: validComps.length,
        propertiesAssessedLower: 0,
        medianValuePerSqft: 0,
        subjectValuePerSqft: 0,
        valueAtTargetPercentile: currentAssessedValue
      },
      riskFlags
    };
  }

  // Calculate $/sqft for all properties
  const compValuesPerSqft = validComps.map(c => ({
    pin: c.pin,
    valuePerSqft: c.assessedValue! / c.squareFootage!,
    assessedValue: c.assessedValue!
  })).sort((a, b) => a.valuePerSqft - b.valuePerSqft);

  const subjectValuePerSqft = subjectSqft > 0
    ? currentAssessedValue / subjectSqft
    : 0;

  // Calculate percentile rank (100 = highest assessed)
  const belowSubject = compValuesPerSqft.filter(c => c.valuePerSqft < subjectValuePerSqft).length;
  const currentPercentileRank = Math.round((belowSubject / validComps.length) * 100);

  // Calculate COD (Coefficient of Dispersion)
  const avgValuePerSqft = compValuesPerSqft.reduce((sum, c) => sum + c.valuePerSqft, 0) / validComps.length;
  const avgDeviation = compValuesPerSqft.reduce((sum, c) => sum + Math.abs(c.valuePerSqft - avgValuePerSqft), 0) / validComps.length;
  const coefficientOfDispersion = avgValuePerSqft > 0 ? (avgDeviation / avgValuePerSqft) * 100 : 0;

  // Find value at target percentile
  const targetIndex = Math.floor(validComps.length * (targetPercentile / 100));
  const valueAtTargetPercentile = compValuesPerSqft[targetIndex]?.valuePerSqft || avgValuePerSqft;

  // Calculate target assessed value
  const targetAssessedValue = subjectSqft > 0
    ? Math.round(valueAtTargetPercentile * subjectSqft)
    : Math.round(compValuesPerSqft[targetIndex]?.assessedValue || currentAssessedValue);

  const potentialReduction = currentAssessedValue - targetAssessedValue;
  const propertiesAssessedLower = belowSubject;

  // Median value per sqft
  const medianIndex = Math.floor(validComps.length / 2);
  const medianValuePerSqft = compValuesPerSqft[medianIndex]?.valuePerSqft || 0;

  rationale.push(`Analyzed ${validComps.length} comparable properties in ${subject.township}`);
  rationale.push(`Subject assessed at ${currentPercentileRank}th percentile (${propertiesAssessedLower} of ${validComps.length} properties assessed lower)`);
  rationale.push(`Subject: $${subjectValuePerSqft.toFixed(2)}/sqft vs Median: $${medianValuePerSqft.toFixed(2)}/sqft`);

  // Determine case strength
  let caseStrength: UNICaseAnalysis['caseStrength'];
  let confidence: number;

  if (currentPercentileRank >= 85 && validComps.length >= 10) {
    caseStrength = 'strong';
    confidence = 0.80;
    rationale.push(`Strong uniformity case: Property in top 15% of assessments`);
  } else if (currentPercentileRank >= 70 && validComps.length >= 5) {
    caseStrength = 'moderate';
    confidence = 0.60;
    rationale.push(`Moderate uniformity case: Property in top 30% of assessments`);
  } else {
    caseStrength = 'weak';
    confidence = 0.30;
    rationale.push(`Assessment falls within typical range for comparable properties`);
  }

  // COD assessment
  if (coefficientOfDispersion > 20) {
    rationale.push(`High variation in neighborhood assessments (COD: ${coefficientOfDispersion.toFixed(1)}%)`);
    riskFlags.push('High assessment variation in area may complicate uniformity argument');
  } else if (coefficientOfDispersion < 10) {
    rationale.push(`Uniform assessments in neighborhood (COD: ${coefficientOfDispersion.toFixed(1)}%)`);
  }

  // Apply quality gate
  if (compQuality.qualityScore < 60) {
    if (caseStrength === 'strong') {
      caseStrength = 'moderate';
      confidence *= 0.7;
    }
    riskFlags.push('Comparable quality below threshold - case strength limited');
  }

  return {
    caseStrength,
    targetAssessedValue,
    currentAssessedValue,
    potentialReduction: Math.max(0, potentialReduction),
    confidence,
    targetPercentile,
    rationale,
    supportingData: {
      currentPercentileRank,
      coefficientOfDispersion,
      comparablePoolSize: validComps.length,
      propertiesAssessedLower,
      medianValuePerSqft,
      subjectValuePerSqft,
      valueAtTargetPercentile
    },
    riskFlags
  };
}

// =============================================================================
// STRATEGY DECISION LOGIC
// =============================================================================

/** Win-rate protection gate thresholds */
const GATES = {
  MIN_ESTIMATED_SAVINGS: 250, // Minimum annual savings to recommend filing
  MIN_COMP_QUALITY: 60,       // Minimum comparable quality score
  MIN_CASE_STRENGTH: 'weak' as const, // At least one case must be better than this
};

/**
 * Decide appeal strategy based on MV and UNI analysis
 */
export function decideAppealStrategy(
  mv: MVCaseAnalysis,
  uni: UNICaseAnalysis,
  compQuality: ComparableQualityAudit,
  subject: NormalizedProperty
): AppealStrategyDecision {
  const reasons: string[] = [];
  const riskFlags: string[] = [...mv.riskFlags, ...uni.riskFlags];
  const gatesTriggered: string[] = [];

  // Tax rate approximation for Cook County
  const TAX_RATE = 0.07; // ~7% for Chicago

  // Calculate potential savings
  const mvSavings = mv.potentialReduction * TAX_RATE;
  const uniSavings = uni.potentialReduction * TAX_RATE;
  const bestSavings = Math.max(mvSavings, uniSavings);

  // Gate 1: Minimum savings threshold
  if (bestSavings < GATES.MIN_ESTIMATED_SAVINGS) {
    gatesTriggered.push('estimated_savings_below_threshold');
    reasons.push(`Estimated savings ($${Math.round(bestSavings)}/year) below threshold of $${GATES.MIN_ESTIMATED_SAVINGS}`);
  }

  // Gate 2: Comparable quality threshold
  if (compQuality.qualityScore < GATES.MIN_COMP_QUALITY) {
    gatesTriggered.push('comp_quality_below_threshold');
    reasons.push(`Comparable quality (${compQuality.qualityScore}) below threshold of ${GATES.MIN_COMP_QUALITY}`);
    riskFlags.push('Low comparable quality - requires manual review');
  }

  // Gate 3: Both cases weak
  if (mv.caseStrength === 'weak' && uni.caseStrength === 'weak') {
    gatesTriggered.push('both_cases_weak');
    reasons.push('Both market value and uniformity cases are weak');
  }

  // Determine strategy
  let strategy: AppealStrategyDecision['strategy'];
  let primaryCase: 'mv' | 'uni' | null = null;
  let targetAssessedValue: number;
  let estimatedSavings: number;

  // If any hard gates triggered, recommend not filing
  if (gatesTriggered.includes('both_cases_weak') ||
      (gatesTriggered.includes('comp_quality_below_threshold') && gatesTriggered.includes('estimated_savings_below_threshold'))) {
    strategy = 'do_not_file';
    targetAssessedValue = subject.assessedValue || 0;
    estimatedSavings = 0;
    reasons.push('Recommendation: Do not file appeal at this time');
  } else {
    // Determine best strategy
    const mvScore = (mv.caseStrength === 'strong' ? 3 : mv.caseStrength === 'moderate' ? 2 : 1) * mv.confidence;
    const uniScore = (uni.caseStrength === 'strong' ? 3 : uni.caseStrength === 'moderate' ? 2 : 1) * uni.confidence;

    if (mv.caseStrength === 'strong' && uni.caseStrength === 'strong') {
      strategy = 'file_both';
      primaryCase = mvScore >= uniScore ? 'mv' : 'uni';
      targetAssessedValue = Math.min(mv.targetAssessedValue, uni.targetAssessedValue);
      estimatedSavings = Math.max(mvSavings, uniSavings);
      reasons.push('Both cases are strong - recommend filing with both arguments');
    } else if (mvScore > uniScore && mv.caseStrength !== 'weak') {
      strategy = 'file_mv';
      primaryCase = 'mv';
      targetAssessedValue = mv.targetAssessedValue;
      estimatedSavings = mvSavings;
      reasons.push('Market value case is stronger - lead with sales/market data');
    } else if (uni.caseStrength !== 'weak') {
      strategy = 'file_uni';
      primaryCase = 'uni';
      targetAssessedValue = uni.targetAssessedValue;
      estimatedSavings = uniSavings;
      reasons.push('Uniformity case is stronger - lead with comparable assessments');
    } else {
      strategy = 'do_not_file';
      targetAssessedValue = subject.assessedValue || 0;
      estimatedSavings = 0;
      reasons.push('Neither case is strong enough to recommend filing');
    }
  }

  // Add savings-based warning even if we recommend filing
  if (strategy !== 'do_not_file' && bestSavings < GATES.MIN_ESTIMATED_SAVINGS) {
    riskFlags.push(`Low potential savings: $${Math.round(bestSavings)}/year - consider if filing is worth the effort`);
  }

  // Calculate overall confidence
  const overallConfidence = strategy === 'do_not_file'
    ? 0.9 // High confidence in not filing
    : strategy === 'file_both'
      ? (mv.confidence + uni.confidence) / 2
      : primaryCase === 'mv' ? mv.confidence : uni.confidence;

  // Generate appeal summary
  let appealSummary: string;
  if (strategy === 'do_not_file') {
    appealSummary = `Based on our analysis of ${compQuality.comparableAudits.length} comparable properties, we do not recommend filing an appeal at this time. ${reasons.join('. ')}.`;
  } else {
    const currentValue = subject.assessedValue?.toLocaleString() || 'unknown';
    const targetValue = targetAssessedValue.toLocaleString();
    const savings = Math.round(estimatedSavings).toLocaleString();

    appealSummary = `We recommend filing a ${strategy === 'file_both' ? 'dual Market Value and Uniformity' : strategy === 'file_mv' ? 'Market Value' : 'Uniformity'} appeal. ` +
      `Current assessment: $${currentValue}. Target: $${targetValue}. ` +
      `Estimated annual savings: $${savings}. ` +
      `${primaryCase === 'mv' ? mv.rationale[0] : uni.rationale[0]}.`;
  }

  return {
    strategy,
    reasons,
    primaryCase,
    estimatedSavings: Math.round(estimatedSavings),
    targetAssessedValue,
    riskFlags,
    gatesTrigered: gatesTriggered,
    overallConfidence,
    appealSummary
  };
}

// =============================================================================
// NO-APPEAL EXPLANATION GENERATOR
// =============================================================================

/**
 * Generate user-friendly explanation for why not to file
 */
export function buildNoAppealExplanation(
  mv: MVCaseAnalysis,
  uni: UNICaseAnalysis,
  compQuality: ComparableQualityAudit,
  subject: NormalizedProperty
): NoAppealExplanation {
  const factors: string[] = [];
  const whatWouldChange: string[] = [];

  // Analyze why cases are weak
  if (mv.caseStrength === 'weak') {
    if (mv.supportingData.salesCount < 3) {
      factors.push('Insufficient recent sales data to establish market value');
      whatWouldChange.push('More comparable properties sell in your area');
    } else {
      factors.push('Assessment appears in line with recent sales prices');
    }
  }

  if (uni.caseStrength === 'weak') {
    if (uni.supportingData.comparablePoolSize < 5) {
      factors.push('Limited comparable properties for uniformity comparison');
      whatWouldChange.push('More similar properties are assessed');
    } else if (uni.supportingData.currentPercentileRank < 70) {
      factors.push(`Assessment ranks ${uni.supportingData.currentPercentileRank}th percentile among comparables (not in top 30%)`);
    }
  }

  if (compQuality.qualityScore < 60) {
    factors.push(`Available comparables don't closely match your property (quality score: ${compQuality.qualityScore}/100)`);
    whatWouldChange.push('Better comparable data becomes available');
  }

  // Calculate potential savings
  const TAX_RATE = 0.07;
  const bestPotentialSavings = Math.max(mv.potentialReduction, uni.potentialReduction) * TAX_RATE;

  if (bestPotentialSavings < 250) {
    factors.push(`Potential savings ($${Math.round(bestPotentialSavings)}/year) may not justify the filing effort`);
    whatWouldChange.push('Your assessment increases significantly in the next reassessment cycle');
  }

  // Determine primary reason
  let primaryReason: string;
  if (factors.length === 0) {
    primaryReason = 'Your property appears to be fairly assessed compared to similar properties in your area.';
  } else if (mv.caseStrength === 'weak' && uni.caseStrength === 'weak') {
    primaryReason = 'Neither market value nor uniformity evidence supports a strong case for appeal.';
  } else if (compQuality.qualityScore < 60) {
    primaryReason = 'Available comparable properties are not similar enough to support a reliable appeal.';
  } else {
    primaryReason = 'The evidence does not suggest your property is significantly overassessed.';
  }

  // Add standard triggers
  if (!whatWouldChange.includes('Your assessment increases significantly in the next reassessment cycle')) {
    whatWouldChange.push('Your assessment increases significantly in the next reassessment cycle');
  }
  whatWouldChange.push('Neighborhood property values decline relative to your assessment');
  whatWouldChange.push('New comparable sales support a lower valuation');

  // Limit to top 3
  const topFactors = factors.slice(0, 3);
  if (topFactors.length < 3) {
    topFactors.push('Current evidence does not meet our threshold for recommending an appeal');
  }

  return {
    primaryReason,
    topFactors,
    whatWouldChange: whatWouldChange.slice(0, 3),
    monitoringMessage: "We'll monitor your property and alert you before the next filing deadline or if conditions change in your favor.",
    recommendWatchlist: true
  };
}

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================

/**
 * Run complete property tax analysis
 */
export function analyzePropertyTaxCase(
  subject: NormalizedProperty,
  comparables: ComparableProperty[],
  sales: ComparableSale[]
): PropertyTaxAnalysisResult {
  // 1. Score comparables
  const compQuality = scoreComparableSet(comparables, subject);

  // 2. Apply adjustments to comparables
  const adjustedComparables = comparables.map(comp => {
    const { adjustedValue, adjustments } = estimateAdjustedValue(comp, subject);
    const audit = compQuality.comparableAudits.find(a => a.pin === comp.pin);
    if (audit) {
      audit.adjustments = adjustments;
      audit.adjustedValue = adjustedValue;
    }
    return { ...comp, adjustedAssessedValue: adjustedValue };
  });

  // 3. Run MV analysis
  const mvCase = analyzeMVCase(subject, adjustedComparables, sales, compQuality);

  // 4. Run UNI analysis
  const uniCase = analyzeUNICase(subject, adjustedComparables, compQuality);

  // 5. Decide strategy
  const strategyDecision = decideAppealStrategy(mvCase, uniCase, compQuality, subject);

  // 6. Build no-appeal explanation if needed
  const noAppealExplanation = strategyDecision.strategy === 'do_not_file'
    ? buildNoAppealExplanation(mvCase, uniCase, compQuality, subject)
    : null;

  return {
    mvCase,
    uniCase,
    comparableQuality: compQuality,
    strategyDecision,
    noAppealExplanation,
    rawData: {
      subject,
      comparables,
      sales
    }
  };
}
