/**
 * Property Tax Appeal Opportunity Analyzer
 *
 * Analyzes a property to determine if it's a good candidate for
 * a property tax appeal. Compares to similar properties and
 * calculates potential savings.
 *
 * POST /api/property-tax/analyze
 * Body: { pin: string }
 * Response: { analysis: AppealOpportunity }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeAppealOpportunity,
  normalizePin,
  AppealOpportunity
} from '../../../lib/cook-county-api';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../../lib/rate-limiter';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - 20 analyses per hour per IP (more intensive)
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
      return res.status(400).json({
        error: 'Please provide a PIN to analyze'
      });
    }

    const normalizedPin = normalizePin(pin);

    // Validate PIN format
    if (normalizedPin.length !== 14 || !/^\d+$/.test(normalizedPin)) {
      return res.status(400).json({
        error: 'Invalid PIN format. Please enter a valid 14-digit Cook County PIN.'
      });
    }

    // Analyze the property
    const analysis = await analyzeAppealOpportunity(normalizedPin);

    // If address is missing from analysis but we have a hint from search, use it
    if (analysis && (!analysis.property.address || analysis.property.address === '') && addressHint) {
      analysis.property.address = addressHint;
    }
    if (analysis && (!analysis.property.township || analysis.property.township === '') && townshipHint) {
      analysis.property.township = townshipHint;
    }

    if (!analysis) {
      return res.status(404).json({
        error: 'Property not found. Please check the PIN and try again.'
      });
    }

    // Get deadline info for the township
    const deadlines = await getDeadlinesForTownship(analysis.property.township);
    if (deadlines) {
      analysis.deadlines = deadlines;
    }

    // Cache comparables for later use
    await cacheComparables(normalizedPin, analysis);

    // Format the response with actionable insights
    const response = formatAnalysisResponse(analysis);

    return res.status(200).json(response);

  } catch (error) {
    console.error('Property analysis error:', error);

    if (error instanceof Error && error.message.includes('SODA API')) {
      return res.status(503).json({
        error: 'Cook County data service is temporarily unavailable. Please try again later.'
      });
    }

    return res.status(500).json({
      error: 'An error occurred while analyzing the property. Please try again.'
    });
  }
}

/**
 * Get appeal deadlines for a township
 */
async function getDeadlinesForTownship(township: string): Promise<AppealOpportunity['deadlines'] | null> {
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

  // Calculate days until deadline
  let daysUntilDeadline: number | null = null;
  const now = new Date();

  if (deadline.bor_close_date) {
    const closeDate = new Date(deadline.bor_close_date);
    if (closeDate > now) {
      daysUntilDeadline = Math.ceil((closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
  } else if (deadline.ccao_close_date) {
    const closeDate = new Date(deadline.ccao_close_date);
    if (closeDate > now) {
      daysUntilDeadline = Math.ceil((closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  return {
    ccaoOpen: deadline.ccao_open_date,
    ccaoClose: deadline.ccao_close_date,
    borOpen: deadline.bor_open_date,
    borClose: deadline.bor_close_date,
    daysUntilDeadline
  };
}

/**
 * Cache comparables for an analysis
 */
async function cacheComparables(pin: string, analysis: AppealOpportunity): Promise<void> {
  // Store in property_tax_properties for future reference
  for (const comp of analysis.comparables) {
    try {
      await supabase
        .from('property_tax_properties')
        .upsert({
          pin: comp.pin,
          pin_formatted: comp.pinFormatted,
          address: comp.address,
          city: comp.city,
          zip_code: comp.zipCode,
          township: comp.township,
          township_code: comp.townshipCode,
          property_class: comp.propertyClass,
          property_class_description: comp.propertyClassDescription,
          square_footage: comp.squareFootage,
          lot_size: comp.lotSize,
          year_built: comp.yearBuilt,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          exterior_construction: comp.exteriorConstruction,
          basement_type: comp.basementType,
          garage_type: comp.garageType,
          assessment_year: comp.assessmentYear,
          current_assessed_value: comp.assessedValue,
          current_market_value: comp.marketValue,
          last_synced_at: new Date().toISOString()
        }, {
          onConflict: 'pin,assessment_year'
        });
    } catch (error) {
      // Log but don't fail
      console.error('Error caching comparable:', error);
    }
  }
}

/**
 * Format the analysis response with actionable insights
 */
function formatAnalysisResponse(analysis: AppealOpportunity) {
  const { property, analysis: stats, comparables, priorAppeals, deadlines } = analysis;

  // Determine recommendation
  let recommendation: 'strongly_recommend' | 'recommend' | 'consider' | 'not_recommended';
  let recommendationText: string;

  if (stats.opportunityScore >= 70 && stats.confidence === 'high') {
    recommendation = 'strongly_recommend';
    recommendationText = 'Strong appeal opportunity. Your property appears significantly overvalued compared to similar properties in your area.';
  } else if (stats.opportunityScore >= 50 && stats.confidence !== 'low') {
    recommendation = 'recommend';
    recommendationText = 'Good appeal opportunity. Your property may be overvalued based on comparable properties.';
  } else if (stats.opportunityScore >= 30) {
    recommendation = 'consider';
    recommendationText = 'Moderate appeal opportunity. You may want to gather additional evidence before filing.';
  } else {
    recommendation = 'not_recommended';
    recommendationText = 'Your property assessment appears to be in line with comparable properties. An appeal may not be worthwhile at this time.';
  }

  // Build action items
  const actionItems: string[] = [];

  if (stats.opportunityScore >= 30) {
    actionItems.push('Review the comparable properties below to understand your case');
    actionItems.push('Gather photos of your property interior and exterior');

    if (stats.appealGrounds.includes('characteristic_error')) {
      actionItems.push('Verify your property characteristics match county records');
    }

    if (stats.appealGrounds.includes('excessive_increase')) {
      actionItems.push('Document your assessment increased significantly from last year - this strengthens your case');
    }

    if (stats.appealGrounds.includes('dramatic_increase')) {
      actionItems.push('Your assessment increased dramatically (40%+) - this is a strong argument for appeal');
    }

    if (deadlines?.daysUntilDeadline && deadlines.daysUntilDeadline > 0) {
      if (deadlines.daysUntilDeadline <= 14) {
        actionItems.push(`URGENT: File your appeal within ${deadlines.daysUntilDeadline} days`);
      } else {
        actionItems.push(`File your appeal before the deadline (${deadlines.daysUntilDeadline} days remaining)`);
      }
    }
  }

  // Format comparables for display
  const formattedComparables = comparables.slice(0, 5).map(comp => ({
    address: comp.address,
    pin: comp.pinFormatted,
    assessedValue: comp.assessedValue,
    marketValue: comp.marketValue,
    squareFootage: comp.squareFootage,
    yearBuilt: comp.yearBuilt,
    bedrooms: comp.bedrooms,
    bathrooms: comp.bathrooms,
    valuePerSqft: comp.valuePerSqft ? Math.round(comp.valuePerSqft * 100) / 100 : null,
    salePrice: comp.salePrice,
    saleDate: comp.saleDate,
    // Similarity to subject
    sqftDifference: comp.sqftDifferencePct ? `${comp.sqftDifferencePct > 0 ? '+' : ''}${Math.round(comp.sqftDifferencePct)}%` : null,
    ageDifference: comp.ageDifferenceYears ? `${comp.ageDifferenceYears > 0 ? '+' : ''}${comp.ageDifferenceYears} years` : null,
  }));

  return {
    success: true,
    property: {
      pin: property.pin,
      pinFormatted: property.pinFormatted,
      address: property.address,
      city: property.city,
      zipCode: property.zipCode,
      township: property.township,
      propertyClass: property.propertyClass,
      propertyClassDescription: property.propertyClassDescription,
      yearBuilt: property.yearBuilt,
      squareFootage: property.squareFootage,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      // Include both field names for compatibility
      assessedValue: property.assessedValue,
      currentAssessedValue: property.assessedValue,
      marketValue: property.marketValue,
      currentMarketValue: property.marketValue,
      priorAssessedValue: property.priorAssessedValue,
      priorMarketValue: property.priorMarketValue,
      // Assessment change from API (calculated in cook-county-api.ts)
      assessmentChangeDollars: property.assessmentChangeDollars,
      assessmentChangePercent: property.assessmentChangePercent,
      // Formatted string for display
      assessmentChange: property.assessmentChangePercent !== null
        ? `${property.assessmentChangePercent > 0 ? '+' : ''}${property.assessmentChangePercent}%`
        : null
    },
    analysis: {
      opportunityScore: stats.opportunityScore,
      confidence: stats.confidence,
      recommendation,
      recommendationText,
      estimatedOvervaluation: Math.round(stats.estimatedOvervaluation),
      // Include both field names for compatibility
      estimatedTaxSavings: Math.round(stats.estimatedTaxSavings),
      estimatedAnnualTaxSavings: Math.round(stats.estimatedTaxSavings),
      // At 35% contingency, user would save 65% of tax savings
      estimatedNetSavings: Math.round(stats.estimatedTaxSavings * 0.65),
      appealGrounds: stats.appealGrounds,
      medianComparableValue: Math.round(stats.medianComparableValue),
      comparableCount: stats.comparableCount,
      comparableStats: {
        count: stats.comparableCount,
        medianAssessedValue: Math.round(stats.medianComparableValue),
        averageAssessedValue: Math.round(stats.averageComparableValue),
        yourValueVsMedian: property.assessedValue && stats.medianComparableValue
          ? ((property.assessedValue - stats.medianComparableValue) / stats.medianComparableValue * 100).toFixed(1) + '%'
          : null
      }
    },
    comparables: formattedComparables,
    priorAppeals: {
      hasAppealed: priorAppeals.hasAppealed,
      lastAppealYear: priorAppeals.lastAppealYear,
      lastAppealResult: priorAppeals.lastAppealResult,
      neighborhoodSuccessRate: priorAppeals.successRate
        ? Math.round(priorAppeals.successRate * 100) + '%'
        : null
    },
    deadlines: {
      township: property.township,
      ccaoOpen: deadlines.ccaoOpen,
      ccaoClose: deadlines.ccaoClose,
      borOpen: deadlines.borOpen,
      borClose: deadlines.borClose,
      daysUntilDeadline: deadlines.daysUntilDeadline,
      status: getDeadlineStatus(deadlines)
    },
    actionItems
  };
}

/**
 * Get deadline status description
 */
function getDeadlineStatus(deadlines: AppealOpportunity['deadlines']): string {
  if (!deadlines.daysUntilDeadline) {
    if (!deadlines.borOpen && !deadlines.ccaoOpen) {
      return 'Deadline dates not yet announced for this township';
    }
    return 'Filing period has closed';
  }

  if (deadlines.daysUntilDeadline <= 0) {
    return 'Filing period has closed';
  }

  if (deadlines.daysUntilDeadline <= 7) {
    return 'Filing deadline approaching - act now!';
  }

  if (deadlines.daysUntilDeadline <= 14) {
    return 'Filing deadline in 2 weeks';
  }

  return 'Filing period is open';
}
