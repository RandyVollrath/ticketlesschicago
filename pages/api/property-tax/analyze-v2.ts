/**
 * Property Tax Appeal Analyzer v2
 *
 * Enhanced analysis with:
 * - Split Market Value (MV) and Uniformity (UNI) case tracking
 * - Comparable quality scoring and audit trails
 * - Conservative adjustments
 * - Win-rate protection gates
 * - No-appeal explanations
 *
 * POST /api/property-tax/analyze-v2
 * Body: { pin: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeAppealOpportunity,
  normalizePin,
  getRecentSuccessfulAppeals,
  checkExemptionEligibility,
} from '../../../lib/cook-county-api';
import {
  analyzePropertyTaxCase,
  PropertyTaxAnalysisResult,
} from '../../../lib/property-tax-analysis';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  try {
    const { pin, addressHint, townshipHint } = req.body;

    if (!pin) {
      return res.status(400).json({ error: 'Please provide a PIN to analyze' });
    }

    const normalizedPin = normalizePin(pin);

    // Validate PIN format
    if (normalizedPin.length !== 14 || !/^\d+$/.test(normalizedPin)) {
      return res.status(400).json({
        error: 'Invalid PIN format. Please enter a valid 14-digit Cook County PIN.'
      });
    }

    // Get the base analysis
    const baseAnalysis = await analyzeAppealOpportunity(normalizedPin);

    if (!baseAnalysis) {
      return res.status(404).json({
        error: 'Property not found. Please check the PIN and try again.'
      });
    }

    // Apply address hints if needed
    if (!baseAnalysis.property.address && addressHint) {
      baseAnalysis.property.address = addressHint;
    }
    if (!baseAnalysis.property.township && townshipHint) {
      baseAnalysis.property.township = townshipHint;
    }

    // Run enhanced MV/UNI analysis
    const enhancedAnalysis = analyzePropertyTaxCase(
      baseAnalysis.property,
      baseAnalysis.comparables,
      baseAnalysis.comparableSales
    );

    // Get additional data
    const [recentSuccesses, exemptions] = await Promise.all([
      baseAnalysis.property.townshipCode
        ? getRecentSuccessfulAppeals(baseAnalysis.property.townshipCode, 5)
        : Promise.resolve([]),
      checkExemptionEligibility(normalizedPin, baseAnalysis.property.assessedValue || 0)
    ]);

    // Get deadline info
    const deadlines = await getDeadlinesForTownship(baseAnalysis.property.township);

    // Format the response
    const response = formatEnhancedResponse(
      baseAnalysis,
      enhancedAnalysis,
      recentSuccesses,
      exemptions,
      deadlines
    );

    return res.status(200).json(response);

  } catch (error) {
    console.error('Property analysis v2 error:', error);
    return res.status(500).json({
      error: 'An error occurred while analyzing the property. Please try again.'
    });
  }
}

async function getDeadlinesForTownship(township: string) {
  const currentYear = new Date().getFullYear();

  const { data: deadline } = await supabase
    .from('property_tax_deadlines')
    .select('*')
    .eq('township', township)
    .eq('year', currentYear)
    .single();

  if (!deadline) {
    return null;
  }

  const borClose = deadline.bor_close_date ? new Date(deadline.bor_close_date) : null;
  const daysUntilDeadline = borClose
    ? Math.ceil((borClose.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    ccaoOpen: deadline.ccao_open_date,
    ccaoClose: deadline.ccao_close_date,
    borOpen: deadline.bor_open_date,
    borClose: deadline.bor_close_date,
    daysUntilDeadline,
  };
}

function formatEnhancedResponse(
  baseAnalysis: any,
  enhancedAnalysis: PropertyTaxAnalysisResult,
  recentSuccesses: any[],
  exemptions: any,
  deadlines: any
) {
  const strategy = enhancedAnalysis.strategyDecision;
  const mv = enhancedAnalysis.mvCase;
  const uni = enhancedAnalysis.uniCase;

  // Determine if we should show the appeal option
  const showAppealOption = strategy.strategy !== 'do_not_file';

  // Calculate estimated savings using the strategy's target value
  const currentValue = baseAnalysis.property.assessedValue || 0;
  const targetValue = strategy.targetAssessedValue;
  const reduction = Math.max(0, currentValue - targetValue);
  const TAX_RATE = 0.07; // Approximate Cook County rate
  const estimatedSavings = reduction * TAX_RATE;

  return {
    property: baseAnalysis.property,

    // Legacy analysis fields for backward compatibility
    analysis: {
      opportunityScore: calculateOpportunityScore(enhancedAnalysis),
      estimatedOvervaluation: reduction,
      estimatedTaxSavings: Math.round(estimatedSavings),
      medianComparableValue: uni.supportingData.valueAtTargetPercentile * (baseAnalysis.property.squareFootage || 1),
      averageComparableValue: baseAnalysis.analysis.averageComparableValue,
      comparableCount: baseAnalysis.comparables.length,
      appealGrounds: buildAppealGrounds(enhancedAnalysis),
      confidence: strategy.overallConfidence >= 0.7 ? 'high' : strategy.overallConfidence >= 0.5 ? 'medium' : 'low',
    },

    // Enhanced v2 analysis
    v2Analysis: {
      // Market Value case
      marketValueCase: {
        strength: mv.caseStrength,
        targetValue: mv.targetAssessedValue,
        potentialReduction: mv.potentialReduction,
        confidence: mv.confidence,
        methodology: mv.methodology,
        rationale: mv.rationale,
        salesData: mv.supportingData,
        riskFlags: mv.riskFlags,
      },

      // Uniformity case
      uniformityCase: {
        strength: uni.caseStrength,
        targetValue: uni.targetAssessedValue,
        potentialReduction: uni.potentialReduction,
        confidence: uni.confidence,
        percentileRank: uni.supportingData.currentPercentileRank,
        rationale: uni.rationale,
        metrics: uni.supportingData,
        riskFlags: uni.riskFlags,
      },

      // Comparable quality
      comparableQuality: {
        score: enhancedAnalysis.comparableQuality.qualityScore,
        assessment: enhancedAnalysis.comparableQuality.aggregateAssessment,
        breakdown: enhancedAnalysis.comparableQuality.scoreBreakdown,
        topComparables: enhancedAnalysis.comparableQuality.comparableAudits.slice(0, 5).map(a => ({
          pin: a.pin,
          pinFormatted: a.pinFormatted,
          address: a.address,
          qualityScore: a.qualityScore,
          whyIncluded: a.whyIncluded,
          adjustedValue: a.adjustedValue,
        })),
      },

      // Strategy decision
      strategyDecision: {
        strategy: strategy.strategy,
        primaryCase: strategy.primaryCase,
        reasons: strategy.reasons,
        targetValue: strategy.targetAssessedValue,
        estimatedSavings: strategy.estimatedSavings,
        riskFlags: strategy.riskFlags,
        gatesTriggered: strategy.gatesTrigered,
        confidence: strategy.overallConfidence,
        summary: strategy.appealSummary,
      },

      // No-appeal explanation (if applicable)
      noAppealExplanation: enhancedAnalysis.noAppealExplanation,

      // Recommend filing?
      recommendFiling: showAppealOption,
    },

    // Comparables with quality scores
    comparables: baseAnalysis.comparables.map((comp: any) => {
      const audit = enhancedAnalysis.comparableQuality.comparableAudits.find(a => a.pin === comp.pin);
      return {
        ...comp,
        qualityScore: audit?.qualityScore || 0,
        whyIncluded: audit?.whyIncluded || [],
        adjustedValue: audit?.adjustedValue,
      };
    }),

    // Sales data
    comparableSales: baseAnalysis.comparableSales,

    // Prior appeals
    priorAppeals: baseAnalysis.priorAppeals,

    // Deadlines
    deadlines,

    // Exemptions
    exemptions,

    // Social proof
    socialProof: recentSuccesses.length >= 3 ? {
      totalSuccessfulAppeals: recentSuccesses.length,
      averageReductionPercent: Math.round(recentSuccesses.reduce((sum, s) => sum + s.reductionPercent, 0) / recentSuccesses.length),
      averageSavings: Math.round(recentSuccesses.reduce((sum, s) => sum + s.estimatedTaxSavings, 0) / recentSuccesses.length),
    } : null,
  };
}

function calculateOpportunityScore(analysis: PropertyTaxAnalysisResult): number {
  const strategy = analysis.strategyDecision;

  if (strategy.strategy === 'do_not_file') {
    // Low score for do not file
    return Math.round(strategy.overallConfidence * 30);
  }

  // Base score from case strengths
  const mvScore = analysis.mvCase.caseStrength === 'strong' ? 40 : analysis.mvCase.caseStrength === 'moderate' ? 25 : 10;
  const uniScore = analysis.uniCase.caseStrength === 'strong' ? 40 : analysis.uniCase.caseStrength === 'moderate' ? 25 : 10;

  // Take the better case score
  const baseScore = Math.max(mvScore, uniScore);

  // Add comparable quality bonus
  const qualityBonus = Math.min(20, analysis.comparableQuality.qualityScore / 5);

  // Add confidence bonus
  const confidenceBonus = Math.round(strategy.overallConfidence * 20);

  // Penalties for risk flags
  const riskPenalty = Math.min(20, strategy.riskFlags.length * 5);

  return Math.max(0, Math.min(100, baseScore + qualityBonus + confidenceBonus - riskPenalty));
}

function buildAppealGrounds(analysis: PropertyTaxAnalysisResult): string[] {
  const grounds: string[] = [];

  // From MV case
  if (analysis.mvCase.caseStrength !== 'weak') {
    if (analysis.mvCase.supportingData.salesCount >= 3) {
      grounds.push('market_sales');
    }
    grounds.push('comparable_sales');
  }

  // From UNI case
  if (analysis.uniCase.caseStrength !== 'weak') {
    if (analysis.uniCase.supportingData.currentPercentileRank >= 70) {
      grounds.push('equity_disparity');
      grounds.push('value_per_sqft');
    }
    if (analysis.uniCase.supportingData.propertiesAssessedLower > 5) {
      grounds.push('lower_assessed_comps');
    }
  }

  return [...new Set(grounds)];
}
