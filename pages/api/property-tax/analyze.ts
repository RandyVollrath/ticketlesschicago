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
  AppealOpportunity,
  getNeighborhoodConditions,
  NeighborhoodConditionsData,
  getTownshipWinRate,
  getPriorAppealOutcomes,
  TownshipWinRate,
  PriorAppealOutcome,
  getRecentSuccessfulAppeals,
  RecentSuccessfulAppeal,
  checkExemptionEligibility,
  ExemptionEligibility
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

    // Check cache first - analyses are valid for 72 hours
    const CACHE_TTL_HOURS = 72;
    const cacheExpiry = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

    const { data: cachedAnalysis } = await supabase
      .from('property_tax_analysis_cache')
      .select('analysis_data, cached_at')
      .eq('pin', normalizedPin)
      .gte('cached_at', cacheExpiry)
      .order('cached_at', { ascending: false })
      .limit(1)
      .single();

    if (cachedAnalysis?.analysis_data) {
      console.log(`Cache hit for PIN ${normalizedPin} (cached ${cachedAnalysis.cached_at})`);
      return res.status(200).json({
        ...cachedAnalysis.analysis_data,
        cached: true,
        cachedAt: cachedAnalysis.cached_at
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

    // Get additional data in parallel: neighborhood conditions, win rate, prior appeals, social proof, exemptions
    const ward = extractWardFromProperty(analysis);
    const [neighborhoodConditions, townshipWinRate, priorAppeals, recentSuccesses, exemptions] = await Promise.all([
      ward ? getNeighborhoodConditions(ward, supabase) : Promise.resolve(null),
      analysis.property.townshipCode
        ? getTownshipWinRate(analysis.property.townshipCode, analysis.property.propertyClass)
        : Promise.resolve(null),
      getPriorAppealOutcomes(normalizedPin),
      analysis.property.townshipCode
        ? getRecentSuccessfulAppeals(analysis.property.townshipCode, 5)
        : Promise.resolve([]),
      checkExemptionEligibility(normalizedPin, analysis.property.assessedValue || 0)
    ]);

    // Cache comparables for later use
    await cacheComparables(normalizedPin, analysis);

    // Format the response with actionable insights
    const response = formatAnalysisResponse(
      analysis,
      neighborhoodConditions,
      townshipWinRate,
      priorAppeals,
      recentSuccesses,
      exemptions
    );

    // Cache the analysis result for future requests (async, don't block response)
    supabase
      .from('property_tax_analysis_cache')
      .upsert({
        pin: normalizedPin,
        analysis_data: response,
        cached_at: new Date().toISOString(),
        township: analysis.property.township,
        opportunity_score: analysis.analysis.opportunityScore
      }, { onConflict: 'pin' })
      .then(({ error }) => {
        if (error) console.error('Failed to cache analysis:', error);
        else console.log(`Cached analysis for PIN ${normalizedPin}`);
      });

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
 * Cache comparables for an analysis - BATCHED for performance
 */
async function cacheComparables(pin: string, analysis: AppealOpportunity): Promise<void> {
  if (!analysis.comparables || analysis.comparables.length === 0) return;

  // Prepare batch data
  const now = new Date().toISOString();
  const records = analysis.comparables.map(comp => ({
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
    last_synced_at: now
  }));

  try {
    // Single batched upsert instead of sequential
    const { error } = await supabase
      .from('property_tax_properties')
      .upsert(records, { onConflict: 'pin,assessment_year' });

    if (error) {
      console.error('Error batch caching comparables:', error);
    }
  } catch (error) {
    console.error('Error caching comparables:', error);
  }
}

/**
 * Format the analysis response with actionable insights
 */
function formatAnalysisResponse(
  analysis: AppealOpportunity,
  neighborhoodConditions: NeighborhoodConditionsData | null = null,
  townshipWinRate: TownshipWinRate | null = null,
  priorAppealOutcomes: PriorAppealOutcome[] = [],
  recentSuccesses: RecentSuccessfulAppeal[] = [],
  exemptions: ExemptionEligibility | null = null
) {
  const { property, analysis: stats, comparables, comparableSales, priorAppeals, deadlines } = analysis;

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

    if (stats.appealGrounds.includes('market_sales')) {
      actionItems.push('Recent sales of similar properties support your case - we found comparable sales data below');
    }

    if (stats.appealGrounds.includes('value_per_sqft')) {
      actionItems.push('Your assessed value per square foot is higher than similar properties - this is strong evidence for your appeal');
    }

    if (stats.appealGrounds.includes('lower_assessed_comps')) {
      actionItems.push('We found comparable properties assessed at lower rates - use these as your primary evidence');
    }

    if (stats.appealGrounds.includes('equity_disparity')) {
      actionItems.push('You are assessed higher than most comparable properties - this is an equity argument the Board takes seriously');
    }

    if (stats.appealGrounds.includes('market_timing')) {
      actionItems.push('Current market conditions favor an appeal - act now while the data supports your case');
    }

    if (stats.appealGrounds.includes('historical_overassessment')) {
      actionItems.push('Your property has been persistently overassessed for years - this pattern strengthens your case');
    }

    // Neighborhood conditions action item (only if it supports reduction)
    if (neighborhoodConditions?.supportsReduction) {
      actionItems.push('Neighborhood condition data shows elevated quality-of-life concerns that may impact property values');
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
      },
      // Sales-based analysis (strongest evidence for appeals)
      salesAnalysis: stats.salesAnalysis ? {
        salesCount: stats.salesAnalysis.salesCount,
        medianSalePrice: stats.salesAnalysis.medianSalePrice,
        averageSalePrice: stats.salesAnalysis.averageSalePrice,
        medianPricePerSqft: stats.salesAnalysis.medianPricePerSqft,
        impliedMarketValue: stats.salesAnalysis.impliedMarketValue,
        assessmentVsSalesGap: stats.salesAnalysis.assessmentVsSalesGap,
        overvaluedByPercent: stats.salesAnalysis.overvaluedByPercent,
        // Human-readable summary
        summary: stats.salesAnalysis.overvaluedByPercent > 10
          ? `Based on ${stats.salesAnalysis.salesCount} recent sales, your property may be overvalued by ${stats.salesAnalysis.overvaluedByPercent}%. Similar properties sold for a median of $${stats.salesAnalysis.medianSalePrice.toLocaleString()}, suggesting your assessment implies a value $${Math.abs(stats.salesAnalysis.assessmentVsSalesGap).toLocaleString()} ${stats.salesAnalysis.assessmentVsSalesGap > 0 ? 'higher' : 'lower'} than market.`
          : `Based on ${stats.salesAnalysis.salesCount} recent sales, your assessment appears reasonable compared to market data.`
      } : null,
      // Per-sqft analysis - critical for fair comparison of similar-sized properties
      perSqftAnalysis: stats.perSqftAnalysis ? {
        yourValuePerSqft: stats.perSqftAnalysis.subjectValuePerSqft,
        medianValuePerSqft: stats.perSqftAnalysis.medianComparableValuePerSqft,
        averageValuePerSqft: stats.perSqftAnalysis.averageComparableValuePerSqft,
        percentAboveMedian: stats.perSqftAnalysis.percentDifferenceFromMedian,
        comparablesUsed: stats.perSqftAnalysis.comparablesWithSqftData,
        impliedFairValue: stats.perSqftAnalysis.impliedFairValue,
        overvaluationAmount: stats.perSqftAnalysis.overvaluationBasedOnSqft,
        // Human-readable summary
        summary: stats.perSqftAnalysis.percentDifferenceFromMedian > 10
          ? `Your property is assessed at $${stats.perSqftAnalysis.subjectValuePerSqft.toFixed(2)}/sqft, which is ${stats.perSqftAnalysis.percentDifferenceFromMedian.toFixed(1)}% higher than the median of $${stats.perSqftAnalysis.medianComparableValuePerSqft.toFixed(2)}/sqft for comparable properties. Based on this, your fair assessed value would be ~$${stats.perSqftAnalysis.impliedFairValue.toLocaleString()}, suggesting you may be overassessed by $${stats.perSqftAnalysis.overvaluationBasedOnSqft.toLocaleString()}.`
          : `Your property is assessed at $${stats.perSqftAnalysis.subjectValuePerSqft.toFixed(2)}/sqft, which is in line with comparable properties (median: $${stats.perSqftAnalysis.medianComparableValuePerSqft.toFixed(2)}/sqft).`
      } : null,
      // APPEAL CASE - Best comparables to use for appeal argument
      appealCase: stats.appealCase ? {
        caseStrength: stats.appealCase.caseStrength,
        targetAssessedValue: stats.appealCase.targetAssessedValue,
        requestedReduction: stats.appealCase.requestedReduction,
        estimatedAnnualSavings: stats.appealCase.estimatedAnnualSavings,
        arguments: stats.appealCase.arguments,
        bestComparables: stats.appealCase.bestComparables.map(c => ({
          pin: c.pinFormatted,
          address: c.address,
          neighborhood: c.neighborhood,
          squareFootage: c.squareFootage,
          bedrooms: c.bedrooms,
          yearBuilt: c.yearBuilt,
          assessedValue: c.assessedValue,
          valuePerSqft: c.valuePerSqft,
          percentLowerThanYou: c.percentLowerThanSubject,
          sameNeighborhood: c.sameNeighborhood,
        })),
      } : null,
      // EQUITY ANALYSIS - How you compare to similar properties
      equityAnalysis: stats.equityAnalysis ? {
        percentileRank: stats.equityAnalysis.percentileRank,
        totalComparables: stats.equityAnalysis.totalComparables,
        propertiesAssessedLower: stats.equityAnalysis.propertiesAssessedLower,
        neighborhoodAvgPerSqft: stats.equityAnalysis.neighborhoodAvgPerSqft,
        vsNeighborhoodAverage: stats.equityAnalysis.vsNeighborhoodAverage,
        equityStatement: stats.equityAnalysis.equityStatement,
      } : null,
      // MARKET TIMING - Is this a good year to appeal?
      marketTiming: stats.marketTiming ? {
        favorableMarket: stats.marketTiming.favorableMarket,
        indicators: stats.marketTiming.indicators,
        summary: stats.marketTiming.summary,
      } : null,
      // HISTORICAL ANALYSIS - Persistent overassessment pattern
      historicalAnalysis: stats.historicalAnalysis ? {
        persistentOverassessment: stats.historicalAnalysis.persistentOverassessment,
        yearsAnalyzed: stats.historicalAnalysis.yearsAnalyzed,
        assessmentGrowthRate: stats.historicalAnalysis.assessmentGrowthRate,
        cumulativeOverassessment: stats.historicalAnalysis.cumulativeOverassessment,
        summary: stats.historicalAnalysis.persistentOverassessment
          ? `Your assessment has grown ${stats.historicalAnalysis.assessmentGrowthRate}% annually over ${stats.historicalAnalysis.yearsAnalyzed} years, faster than typical market growth. This pattern of over-assessment strengthens your appeal.`
          : `Your assessment growth of ${stats.historicalAnalysis.assessmentGrowthRate}% annually is in line with market trends.`
      } : null,
      // NEIGHBORHOOD CONDITIONS - Layer 4: Quality of life indicators from 311 data
      neighborhoodConditions: neighborhoodConditions ? {
        ward: neighborhoodConditions.ward,
        communityArea: neighborhoodConditions.communityArea,
        conditionRating: neighborhoodConditions.conditionRating,
        distressScore: neighborhoodConditions.distressScore,
        supportsReduction: neighborhoodConditions.supportsReduction,
        indicators: {
          vacantBuildings: {
            count: neighborhoodConditions.indicators.vacantBuildings.count,
            trend: neighborhoodConditions.indicators.vacantBuildings.trend,
            vsAverage: `${neighborhoodConditions.indicators.vacantBuildings.percentile}% of city average`,
          },
          rodentComplaints: {
            count: neighborhoodConditions.indicators.rodentComplaints.count,
            trend: neighborhoodConditions.indicators.rodentComplaints.trend,
            vsAverage: `${neighborhoodConditions.indicators.rodentComplaints.percentile}% of city average`,
          },
          graffitiRequests: {
            count: neighborhoodConditions.indicators.graffitiRequests.count,
            trend: neighborhoodConditions.indicators.graffitiRequests.trend,
            vsAverage: `${neighborhoodConditions.indicators.graffitiRequests.percentile}% of city average`,
          },
          abandonedVehicles: {
            count: neighborhoodConditions.indicators.abandonedVehicles.count,
            trend: neighborhoodConditions.indicators.abandonedVehicles.trend,
            vsAverage: `${neighborhoodConditions.indicators.abandonedVehicles.percentile}% of city average`,
          },
          buildingViolations: {
            count: neighborhoodConditions.indicators.buildingViolations.count,
            trend: neighborhoodConditions.indicators.buildingViolations.trend,
            vsAverage: `${neighborhoodConditions.indicators.buildingViolations.percentile}% of city average`,
          },
        },
        conditionsStatement: neighborhoodConditions.conditionsStatement,
        summary: neighborhoodConditions.supportsReduction
          ? `Ward ${neighborhoodConditions.ward} shows elevated neighborhood distress indicators (score: ${neighborhoodConditions.distressScore}/100). This data may support an argument that environmental factors negatively impact property values.`
          : `Ward ${neighborhoodConditions.ward} neighborhood conditions are ${neighborhoodConditions.conditionRating === 'stable' ? 'stable' : 'showing some concerns'} (distress score: ${neighborhoodConditions.distressScore}/100).`
      } : null
    },
    comparables: formattedComparables,
    // Comparable sales - actual recent sales of similar properties
    comparableSales: comparableSales ? comparableSales.slice(0, 6).map(sale => ({
      pin: sale.pinFormatted,
      address: sale.address,
      saleDate: sale.saleDate,
      salePrice: sale.salePrice,
      pricePerSqft: sale.pricePerSqft ? Math.round(sale.pricePerSqft) : null,
      squareFootage: sale.squareFootage,
      bedrooms: sale.bedrooms,
      yearBuilt: sale.yearBuilt,
      neighborhood: sale.neighborhood,
      // Comparison to subject property
      sqftDifference: sale.sqftDifferencePct ? `${sale.sqftDifferencePct > 0 ? '+' : ''}${Math.round(sale.sqftDifferencePct)}%` : null,
      ageDifference: sale.ageDifferenceYears ? `${sale.ageDifferenceYears > 0 ? '+' : ''}${sale.ageDifferenceYears} years` : null,
      priceDifferenceFromAssessed: sale.priceDifferenceFromAssessed ? Math.round(sale.priceDifferenceFromAssessed) : null,
    })) : [],
    priorAppeals: {
      hasAppealed: priorAppeals.hasAppealed,
      lastAppealYear: priorAppeals.lastAppealYear,
      lastAppealResult: priorAppeals.lastAppealResult,
      neighborhoodSuccessRate: priorAppeals.successRate
        ? Math.round(priorAppeals.successRate * 100) + '%'
        : null
    },
    // Historical win rate for this township/property class
    townshipWinRate: townshipWinRate ? {
      winRate: townshipWinRate.winRate,
      winRateFormatted: `${townshipWinRate.winRate}%`,
      totalAppeals: townshipWinRate.totalAppeals,
      successfulAppeals: townshipWinRate.successfulAppeals,
      avgReductionPercent: townshipWinRate.avgReductionPercent,
      avgReductionDollars: townshipWinRate.avgReductionDollars,
      dataYears: townshipWinRate.dataYears,
      summary: townshipWinRate.winRate >= 50
        ? `Properties like yours have a ${townshipWinRate.winRate}% success rate on appeal, with average reductions of ${townshipWinRate.avgReductionPercent}%.`
        : `Historical data shows a ${townshipWinRate.winRate}% success rate for similar properties. Strong evidence improves your chances.`
    } : null,
    // This PIN's prior appeal history with outcomes
    priorAppealHistory: priorAppealOutcomes.length > 0 ? {
      hasAppealed: true,
      appealCount: priorAppealOutcomes.length,
      appeals: priorAppealOutcomes.map(a => ({
        taxYear: a.taxYear,
        preAppealValue: a.preAppealValue,
        postAppealValue: a.postAppealValue,
        reduction: a.reduction,
        reductionPercent: a.reductionPercent,
        success: a.success
      })),
      successCount: priorAppealOutcomes.filter(a => a.success).length,
      summary: priorAppealOutcomes.some(a => a.success)
        ? `This property has successfully appealed before (${priorAppealOutcomes.filter(a => a.success).length} wins). Prior success strengthens your case.`
        : 'This property has appealed before but was not reduced. New comparable data may support a different outcome.'
    } : {
      hasAppealed: false,
      appealCount: 0,
      appeals: [],
      successCount: 0,
      summary: 'No prior appeal history found for this property.'
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
    actionItems,
    // SOCIAL PROOF - Recent successful appeals in this township (from public BOR data)
    socialProof: recentSuccesses.length >= 3 ? {
      // Show aggregate stats, not individual properties (privacy + we don't have addresses)
      totalSuccessfulAppeals: recentSuccesses.length,
      averageReductionPercent: Math.round(recentSuccesses.reduce((sum, s) => sum + s.reductionPercent, 0) / recentSuccesses.length),
      averageSavings: Math.round(recentSuccesses.reduce((sum, s) => sum + s.estimatedTaxSavings, 0) / recentSuccesses.length),
      recentExamples: recentSuccesses.slice(0, 3).map(s => ({
        taxYear: s.taxYear,
        reductionPercent: s.reductionPercent,
        estimatedSavings: s.estimatedTaxSavings,
        propertyClass: s.propertyClass
      })),
      summary: `${recentSuccesses.length} properties in ${property.township} have successfully appealed in the last 2 years, with average reductions of ${Math.round(recentSuccesses.reduce((sum, s) => sum + s.reductionPercent, 0) / recentSuccesses.length)}% and average savings of $${Math.round(recentSuccesses.reduce((sum, s) => sum + s.estimatedTaxSavings, 0) / recentSuccesses.length).toLocaleString()}/year.`
    } : null, // Only show if we have at least 3 examples
    // EXEMPTION ELIGIBILITY - Tax exemptions the owner may qualify for
    exemptions: exemptions ? {
      currentlyHasHomeowner: exemptions.currentlyHasHomeowner,
      currentlyHasSenior: exemptions.currentlyHasSenior,
      currentlyHasSeniorFreeze: exemptions.currentlyHasSeniorFreeze,
      currentlyHasDisabledVet: exemptions.currentlyHasDisabledVet,
      eligibleExemptions: exemptions.eligibleExemptions.map(e => ({
        type: e.type,
        name: e.name,
        potentialSavings: e.potentialSavings,
        requirements: e.requirements,
        howToApply: e.howToApply
      })),
      totalPotentialSavings: exemptions.totalPotentialSavings,
      hasMissingExemptions: exemptions.eligibleExemptions.length > 0,
      summary: exemptions.eligibleExemptions.length > 0
        ? `You may be eligible for ${exemptions.eligibleExemptions.length} exemption(s) that could save you up to $${exemptions.totalPotentialSavings.toLocaleString()} annually. These are separate from appealing your assessment.`
        : 'You appear to have all available exemptions applied to your property.'
    } : null
  };
}

/**
 * Extract ward number from property data
 * Chicago wards are 1-50; we try to get it from various sources
 */
function extractWardFromProperty(analysis: AppealOpportunity): number | null {
  // Ward is typically encoded in Chicago addresses or can be looked up
  // For now, we'll extract from township code or use a mapping
  // Chicago townships and their approximate ward ranges:
  const townshipToWardMap: Record<string, number[]> = {
    'Lake View': [43, 44, 46, 47],
    'Rogers Park': [49, 50],
    'Hyde Park': [4, 5, 20],
    'South Chicago': [7, 8, 10],
    'Jefferson': [11, 12, 19, 34],
    'West Chicago': [27, 28, 29, 37],
    'Lake': [42, 43, 46],
  };

  // Try to get ward from township
  const township = analysis.property.township;
  if (township && townshipToWardMap[township]) {
    // Return first ward as representative for now
    // In production, would use geocoding to get exact ward
    return townshipToWardMap[township][0];
  }

  // Default to null - we'll skip neighborhood analysis
  return null;
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
