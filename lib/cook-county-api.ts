/**
 * Cook County Property Tax API Integration
 *
 * Integrates with Cook County Assessor's Socrata Open Data API
 * to fetch property data, assessments, comparables, and appeal history.
 *
 * Data Sources:
 * - Property Characteristics: https://datacatalog.cookcountyil.gov/resource/bcnq-qi2z
 * - Assessed Values: https://datacatalog.cookcountyil.gov/resource/uzyt-m557
 * - Residential Sales: https://datacatalog.cookcountyil.gov/resource/5pge-nu6u
 * - Board of Review Decisions: https://datacatalog.cookcountyil.gov/resource/7pny-nedm
 */

import { fetchWithTimeout, fetchWithRetry, DEFAULT_TIMEOUTS } from './fetch-with-timeout';

// Socrata API base URL
const SOCRATA_BASE_URL = 'https://datacatalog.cookcountyil.gov/resource';

// Dataset IDs
const DATASETS = {
  // Property characteristics (residential single-family/multi-family)
  CHARACTERISTICS: 'bcnq-qi2z',
  // Assessed values history
  ASSESSED_VALUES: 'uzyt-m557',
  // Residential sales (ARCHIVED - only has data through 2019)
  SALES_ARCHIVED: '5pge-nu6u',
  // Parcel Sales - CURRENT (updated daily, has 2024-2025 data)
  PARCEL_SALES: 'wvhk-k5uv',
  // Board of Review decisions
  BOR_DECISIONS: '7pny-nedm',
  // Condo unit characteristics (correct ID as of 2024)
  CONDO_CHARACTERISTICS: '3r7i-mrz4',
} as const;

// Property class codes for residential properties
const RESIDENTIAL_CLASSES = ['202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212', '234', '278', '295'];

// Cook County townships (for deadline tracking)
export const TOWNSHIPS = [
  'Barrington', 'Berwyn', 'Bloom', 'Bremen', 'Calumet', 'Cicero',
  'Elk Grove', 'Evanston', 'Hanover', 'Hyde Park', 'Jefferson', 'Lake',
  'Lake View', 'Lemont', 'Leyden', 'Lyons', 'Maine', 'New Trier',
  'Niles', 'Northfield', 'Norwood Park', 'Oak Park', 'Orland', 'Palatine',
  'Palos', 'Proviso', 'Rich', 'River Forest', 'Riverside', 'Rogers Park',
  'Schaumburg', 'South Chicago', 'Stickney', 'Thornton', 'West Chicago',
  'Wheeling', 'Worth'
] as const;

export type Township = typeof TOWNSHIPS[number];

// Interfaces for API responses
// Based on actual Socrata API field names from datacatalog.cookcountyil.gov
export interface PropertyCharacteristics {
  pin: string;
  class: string;
  town_code: string;  // Township code
  nbhd: string;  // Assessment neighborhood
  tax_year: string;
  age: string;  // Property age
  bldg_sf: string;  // Building square footage
  hd_sf: string;  // Land square footage (heated dwelling sf)
  beds: string;
  fbath: string;  // Full baths
  hbath: string;  // Half baths
  rooms: string;
  ext_wall: string;  // Exterior wall type
  bsmt: string;  // Basement type
  bsmt_fin: string;  // Basement finish
  gar1_size: string;  // Garage size
  attic_fnsh: string;  // Attic finish
  air: string;  // AC type
  addr: string;  // Property address
  // Note: city/zip not in main dataset, would need to join with other data
}

export interface AssessedValue {
  pin: string;
  year: string;  // Tax year
  class: string;
  township_code: string;
  township_name: string;
  nbhd: string;
  mailed_tot?: string;  // Mailed total assessed value
  certified_tot?: string;  // Certified total assessed value
  board_tot?: string;  // Board of Review total assessed value (may not exist for current year)
  mailed_bldg?: string;
  mailed_land?: string;
  certified_bldg?: string;
  certified_land?: string;
  board_bldg?: string;
  board_land?: string;
}

export interface SaleRecord {
  pin: string;
  sale_date: string;
  sale_price: string;
  sale_document_num: string;
  sale_deed_type: string;
  class: string;
  township_code: string;
  nbhd: string;
  char_bldg_sf: string;
  char_yrblt: string;
}

export interface BORDecision {
  pin: string;
  tax_year: string;
  class: string;
  township_code: string;
  change: string;  // result of appeal
  reason: string;  // reason for change
  tot_pre_mktval: string;  // pre-appeal market value
  tot_post_mktval: string;  // post-appeal market value
}

// Parcel Sales from dataset wvhk-k5uv (current, updated daily)
export interface ParcelSale {
  pin: string;
  year: string;
  township_code: string;
  nbhd: string;
  class: string;
  sale_date: string;
  sale_price: string;
  doc_no: string;
  deed_type: string;
  seller_name?: string;
  buyer_name?: string;
  is_multisale: boolean;
  num_parcels_sale: string;
  // Filters to identify arm's-length transactions
  sale_filter_same_sale_within_365: boolean;
  sale_filter_less_than_10k: boolean;
  sale_filter_deed_type: boolean;
}

// Comparable sale with enriched data
export interface ComparableSale {
  pin: string;
  pinFormatted: string;
  address: string;
  saleDate: string;
  salePrice: number;
  pricePerSqft: number | null;
  squareFootage: number | null;
  bedrooms: number | null;
  yearBuilt: number | null;
  township: string;
  neighborhood: string;
  propertyClass: string;
  // Comparison to subject
  sqftDifferencePct: number | null;
  ageDifferenceYears: number | null;
  priceDifferenceFromAssessed: number | null;
}

// Condo characteristics from dataset 3r7i-mrz4
export interface CondoCharacteristics {
  pin: string;
  pin10: string;  // Building PIN (first 10 digits)
  card: string;
  year: string;
  class: string;
  township_code: string;
  tieback_key_pin: string;
  tieback_proration_rate: string;  // Unit's share of building value (0.0 to 1.0)
  card_proration_rate: string;
  char_yrblt: string;  // Year built
  char_building_sf: string;  // TOTAL Building square footage (not unit!)
  char_unit_sf?: string;  // Unit square footage (often missing)
  char_bedrooms: string;  // Number of bedrooms
  char_full_baths?: string;  // Full bathrooms
  char_half_baths?: string;  // Half bathrooms
  char_building_non_units: string;
  char_building_pins: string;  // Number of units in building
  char_land_sf: string;
  pin_is_multiland: string | boolean;
  pin_num_landlines: string;
  bldg_is_mixed_use: string | boolean;
  is_parking_space: string | boolean;
  is_common_area: string | boolean;
}

// Normalized property data for our system
export interface NormalizedProperty {
  pin: string;
  pinFormatted: string;
  address: string;
  city: string;
  zipCode: string;
  township: string;
  townshipCode: string;
  neighborhood: string;
  propertyClass: string;
  propertyClassDescription: string;
  yearBuilt: number | null;
  squareFootage: number | null;
  lotSize: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  exteriorConstruction: string | null;
  basementType: string | null;
  garageType: string | null;
  assessmentYear: number;
  assessedValue: number | null;
  marketValue: number | null;
  priorAssessedValue: number | null;
  priorMarketValue: number | null;
  // Year-over-year change tracking
  assessmentChangeDollars: number | null;  // Current - Prior
  assessmentChangePercent: number | null;  // ((Current - Prior) / Prior) * 100
}

export interface ComparableProperty extends NormalizedProperty {
  distanceMiles: number | null;
  salePrice: number | null;
  saleDate: string | null;
  valuePerSqft: number | null;
  sqftDifferencePct: number | null;
  ageDifferenceYears: number | null;
}

export interface AppealOpportunity {
  property: NormalizedProperty;
  comparables: ComparableProperty[];
  /** Actual recent sales of similar properties - strongest evidence for appeals */
  comparableSales: ComparableSale[];
  analysis: {
    opportunityScore: number;  // 0-100
    estimatedOvervaluation: number;
    estimatedTaxSavings: number;
    medianComparableValue: number;
    averageComparableValue: number;
    comparableCount: number;
    appealGrounds: string[];
    confidence: 'high' | 'medium' | 'low';
    /** Per-sqft analysis - critical for fair comparisons */
    perSqftAnalysis?: {
      /** Subject property's assessed value per sqft */
      subjectValuePerSqft: number;
      /** Median assessed value per sqft among comparables */
      medianComparableValuePerSqft: number;
      /** Average assessed value per sqft among comparables */
      averageComparableValuePerSqft: number;
      /** Percentage difference: (subject - median) / median * 100 */
      percentDifferenceFromMedian: number;
      /** Number of comparables with valid sqft data */
      comparablesWithSqftData: number;
      /** Implied fair value for subject based on median $/sqft */
      impliedFairValue: number;
      /** Estimated overvaluation in dollars based on $/sqft */
      overvaluationBasedOnSqft: number;
    };
    /** Sales-based analysis */
    salesAnalysis?: {
      medianSalePrice: number;
      averageSalePrice: number;
      medianPricePerSqft: number;
      salesCount: number;
      /** What market data suggests property is worth */
      impliedMarketValue: number;
      /** How much higher assessment is than sales suggest */
      assessmentVsSalesGap: number;
      /** Percentage overvalued based on sales */
      overvaluedByPercent: number;
    };
    // =========================================================================
    // THREE-LAYER CREDIBILITY ARCHITECTURE
    // Layer 1: Market Value - What is the property actually worth?
    // Layer 2: Equity/Uniformity - Are similar properties assessed consistently?
    // Layer 3: Assessment Drift - Has this property been systematically overtaxed?
    // =========================================================================

    /**
     * LAYER 1: MARKET VALUE ANALYSIS
     * Uses median/regression analysis to determine fair market value.
     * This is the primary valuation argument for appeals.
     */
    marketValueAnalysis?: {
      /** Methodology used for valuation */
      methodology: 'median_comparable' | 'regression' | 'sales_comparison';
      /** Fair market value based on comparable assessments */
      fairAssessedValue: number;
      /** Median $/sqft across all valid comparables */
      medianValuePerSqft: number;
      /** Mean $/sqft across all valid comparables */
      meanValuePerSqft: number;
      /** Subject's current $/sqft */
      subjectValuePerSqft: number;
      /** Difference from median (positive = overassessed) */
      deviationFromMedian: number;
      /** Percentage above median */
      percentAboveMedian: number;
      /** Top comparables used for valuation (representative sample) */
      representativeComparables: Array<{
        pin: string;
        pinFormatted: string;
        address: string;
        neighborhood: string;
        squareFootage: number;
        bedrooms: number | null;
        yearBuilt: number | null;
        assessedValue: number;
        valuePerSqft: number;
        sameNeighborhood: boolean;
      }>;
      /** Valuation confidence */
      confidence: 'high' | 'medium' | 'low';
      /** Professional language for appeal */
      valuationStatement: string;
    };

    /**
     * LAYER 2: UNIFORMITY/EQUITY ANALYSIS
     * Detects systematic inconsistencies in assessment practices.
     * Equal protection argument - similar properties should be assessed similarly.
     */
    uniformityAnalysis?: {
      /** Subject's percentile rank (100 = highest assessed among comparables) */
      percentileRank: number;
      /** Number of comparable properties analyzed */
      comparablePoolSize: number;
      /** Properties assessed at lower rates per sqft */
      propertiesAssessedLower: number;
      /** Coefficient of dispersion - measures assessment uniformity */
      coefficientOfDispersion: number;
      /** Neighborhood-specific analysis */
      neighborhoodMetrics: {
        avgValuePerSqft: number;
        subjectVsNeighborhood: number;
        sampleSize: number;
      };
      /** Assessment uniformity rating */
      uniformityRating: 'consistent' | 'moderate_variation' | 'significant_disparity';
      /** Professional statement for appeal */
      uniformityStatement: string;
    };

    /**
     * LAYER 3: ASSESSMENT DRIFT ANALYSIS
     * Identifies historical patterns of overassessment.
     * Shows systematic errors requiring correction.
     */
    driftAnalysis?: {
      /** Has assessment consistently outpaced market? */
      systematicOverassessment: boolean;
      /** Years of data analyzed */
      yearsAnalyzed: number;
      /** Compound annual growth rate of assessments */
      assessmentCAGR: number;
      /** Estimated market CAGR for comparison */
      marketCAGR: number;
      /** Excess growth (assessment CAGR - market CAGR) */
      excessGrowthRate: number;
      /** Cumulative overassessment in dollars */
      cumulativeExcess: number;
      /** Assessment history for charting */
      assessmentHistory: Array<{
        year: number;
        assessedValue: number;
      }>;
      /** Professional statement for appeal */
      driftStatement: string;
    };

    /**
     * LAYER 4: NEIGHBORHOOD CONDITIONS ANALYSIS
     * Uses Chicago 311 data and other indicators to identify neighborhood
     * factors that may impact property values. Secondary supporting evidence.
     */
    neighborhoodConditions?: {
      /** Ward number for the property */
      ward: number;
      /** Community area number */
      communityArea: number | null;
      /** Overall neighborhood condition rating */
      conditionRating: 'stable' | 'some_concerns' | 'significant_concerns';
      /** Key indicators from 311 data */
      indicators: {
        /** Vacant/abandoned building complaints */
        vacantBuildings: {
          count: number;
          trend: 'increasing' | 'stable' | 'decreasing';
          percentile: number; // vs city average
        };
        /** Rodent/pest complaints */
        rodentComplaints: {
          count: number;
          trend: 'increasing' | 'stable' | 'decreasing';
          percentile: number;
        };
        /** Graffiti removal requests */
        graffitiRequests: {
          count: number;
          trend: 'increasing' | 'stable' | 'decreasing';
          percentile: number;
        };
        /** Abandoned vehicle complaints */
        abandonedVehicles: {
          count: number;
          trend: 'increasing' | 'stable' | 'decreasing';
          percentile: number;
        };
        /** Building violations */
        buildingViolations: {
          count: number;
          trend: 'increasing' | 'stable' | 'decreasing';
          percentile: number;
        };
      };
      /** Composite neighborhood distress score (0-100, higher = more distress) */
      distressScore: number;
      /** Whether conditions support a property value reduction argument */
      supportsReduction: boolean;
      /** Professional statement for appeal (only if supportsReduction is true) */
      conditionsStatement: string | null;
    };

    /**
     * CONSOLIDATED APPEAL SUMMARY
     * Combines all four layers into actionable appeal guidance.
     */
    appealSummary?: {
      /** Recommended target value based on all evidence */
      recommendedAssessedValue: number;
      /** Reduction being requested */
      requestedReduction: number;
      /** Estimated annual tax savings */
      estimatedAnnualSavings: number;
      /** Overall case strength */
      overallStrength: 'strong' | 'moderate' | 'weak';
      /** Strongest arguments ranked by effectiveness */
      primaryArguments: Array<{
        type: 'market_value' | 'uniformity' | 'assessment_drift' | 'neighborhood_conditions';
        strength: number; // 0-100
        summary: string;
      }>;
      /** Professionally-worded appeal statement */
      appealStatement: string;
    };

    /** MARKET TIMING - is this a good year to appeal? */
    marketTiming?: {
      /** Is this a favorable market for appeals? */
      favorableMarket: boolean;
      /** Market indicators */
      indicators: {
        /** Average days on market trend */
        domTrend: 'rising' | 'stable' | 'falling' | 'unknown';
        /** Sales volume trend */
        salesVolumeTrend: 'declining' | 'stable' | 'increasing' | 'unknown';
        /** Price trend */
        priceTrend: 'declining' | 'stable' | 'rising' | 'unknown';
      };
      /** Market timing summary */
      summary: string;
    };

    // Legacy fields for backward compatibility (deprecated - use new analysis layers)
    /** @deprecated Use marketValueAnalysis instead */
    appealCase?: {
      bestComparables: Array<{
        pin: string;
        pinFormatted: string;
        address: string;
        neighborhood: string;
        squareFootage: number;
        bedrooms: number | null;
        yearBuilt: number | null;
        assessedValue: number;
        valuePerSqft: number;
        percentLowerThanSubject: number;
        sameNeighborhood: boolean;
      }>;
      targetAssessedValue: number;
      requestedReduction: number;
      estimatedAnnualSavings: number;
      caseStrength: 'strong' | 'moderate' | 'weak';
      arguments: string[];
    };
    /** @deprecated Use uniformityAnalysis instead */
    equityAnalysis?: {
      percentileRank: number;
      totalComparables: number;
      propertiesAssessedLower: number;
      neighborhoodAvgPerSqft: number;
      vsNeighborhoodAverage: number;
      equityStatement: string;
    };
    /** @deprecated Use driftAnalysis instead */
    historicalAnalysis?: {
      persistentOverassessment: boolean;
      yearsAnalyzed: number;
      assessmentGrowthRate: number;
      cumulativeOverassessment: number;
    };
  };
  priorAppeals: {
    hasAppealed: boolean;
    lastAppealYear: number | null;
    lastAppealResult: string | null;
    successRate: number | null;
  };
  deadlines: {
    ccaoOpen: string | null;
    ccaoClose: string | null;
    borOpen: string | null;
    borClose: string | null;
    daysUntilDeadline: number | null;
  };
}

// Helper functions

/**
 * Format a 14-digit PIN with dashes for display
 * Input: 14082030010000 -> Output: 14-08-203-001-0000
 */
export function formatPin(pin: string): string {
  const cleaned = pin.replace(/\D/g, '').padStart(14, '0');
  return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7, 10)}-${cleaned.slice(10, 14)}`;
}

/**
 * Normalize a PIN to 14 digits without dashes
 */
export function normalizePin(pin: string): string {
  return pin.replace(/\D/g, '').padStart(14, '0');
}

/**
 * Parse a string value to number, returning null if invalid
 */
function parseNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Parse an integer, returning null if invalid
 */
function parseInt(value: string | undefined | null): number | null {
  if (!value) return null;
  const num = Number.parseInt(value, 10);
  return isNaN(num) ? null : num;
}

/**
 * Calculate assessment change (dollars and percent) from current and prior values
 */
function calculateAssessmentChange(
  currentValue: number | null,
  priorValue: number | null
): { assessmentChangeDollars: number | null; assessmentChangePercent: number | null } {
  if (currentValue === null || priorValue === null || priorValue === 0) {
    return { assessmentChangeDollars: null, assessmentChangePercent: null };
  }
  const dollars = currentValue - priorValue;
  const percent = ((currentValue - priorValue) / priorValue) * 100;
  return {
    assessmentChangeDollars: dollars,
    assessmentChangePercent: Math.round(percent * 10) / 10 // Round to 1 decimal
  };
}

/**
 * Get adjacent township codes for expanded comparable search
 * Cook County township codes and their neighbors for condo comparables
 */
function getAdjacentTownships(townshipCode: string): string[] {
  // Chicago township adjacency map (codes)
  // These are approximate - for property tax appeals, nearby townships are valid comparables
  const adjacencyMap: Record<string, string[]> = {
    // Lake View (76) - Lincoln Park, Rogers Park, North Chicago
    '76': ['70', '74', '77'],
    // Lincoln Park area / Lake (70)
    '70': ['76', '74', '77'],
    // Rogers Park (74)
    '74': ['76', '70', '77'],
    // Hyde Park (38)
    '38': ['39', '35', '25'],
    // South Chicago (39)
    '39': ['38', '35'],
    // Jefferson (25)
    '25': ['38', '26', '35'],
    // West Chicago (26)
    '26': ['25', '27', '35'],
    // North (77)
    '77': ['76', '70', '74'],
  };

  return adjacencyMap[townshipCode] || [];
}

/**
 * Get property class description
 */
function getPropertyClassDescription(classCode: string): string {
  const descriptions: Record<string, string> = {
    '202': 'Single-family home (less than 1 acre)',
    '203': 'Single-family home (on 1+ acres)',
    '204': 'Single-family attached (row house)',
    '205': 'Single-family home (under construction)',
    '206': 'Two-family home',
    '207': 'Three-family home',
    '208': 'Four-family home',
    '209': 'Five-family home',
    '210': 'Six-family home',
    '211': 'Mixed-use (1-6 units with commercial)',
    '212': 'Apartment building (7+ units)',
    '234': 'Split-level single-family',
    '278': 'Townhouse',
    '295': 'Vacant residential land',
    '299': 'Condominium',
    '399': 'Condominium parking space',
  };
  return descriptions[classCode] || `Class ${classCode}`;
}

/**
 * Query the Socrata API with retry support
 * Uses a longer timeout (45s) because Cook County's API can be slow
 * Includes retry logic to handle cold starts and temporary failures
 */
async function querySODA<T>(
  dataset: string,
  params: Record<string, string>,
  timeout: number = 45000, // 45 seconds - Cook County API can be very slow
  maxRetries: number = 2
): Promise<T[]> {
  const queryParams = new URLSearchParams();

  // Add all params
  for (const [key, value] of Object.entries(params)) {
    queryParams.set(key, value);
  }

  const url = `${SOCRATA_BASE_URL}/${dataset}.json?${queryParams.toString()}`;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        timeout,
        headers: {
          'Accept': 'application/json',
          // App token is optional but recommended for higher rate limits
          ...(process.env.SOCRATA_APP_TOKEN && {
            'X-App-Token': process.env.SOCRATA_APP_TOKEN
          })
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`SODA API error for ${dataset}:`, response.status, errorText);
        throw new Error(`SODA API returned ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`SODA query attempt ${attempt + 1} failed for ${dataset}:`, lastError.message);

      // Don't retry if it's not a timeout or network error
      if (lastError.message.includes('SODA API returned')) {
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  console.error(`Error querying SODA dataset ${dataset} after ${maxRetries} attempts:`, lastError);
  throw lastError;
}

// Main API Functions

/**
 * Look up a property by PIN
 * Checks both residential and condo datasets to get complete data
 * Condos may have address in residential dataset but bedroom/sqft in condo dataset
 */
export async function getPropertyByPin(pin: string): Promise<NormalizedProperty | null> {
  const normalizedPin = normalizePin(pin);
  const currentYear = new Date().getFullYear();

  // Query both datasets in parallel for speed
  const [characteristics, values, condoCharacteristics] = await Promise.all([
    // Property characteristics from residential dataset
    querySODA<PropertyCharacteristics>(
      DATASETS.CHARACTERISTICS,
      {
        '$where': `pin = '${normalizedPin}'`,
        '$order': 'tax_year DESC',
        '$limit': '1'
      }
    ),
    // Assessed values (needed for both residential and condo)
    querySODA<AssessedValue>(
      DATASETS.ASSESSED_VALUES,
      {
        '$where': `pin = '${normalizedPin}'`,
        '$order': 'year DESC',
        '$limit': '2'
      }
    ),
    // Condo characteristics
    querySODA<CondoCharacteristics>(
      DATASETS.CONDO_CHARACTERISTICS,
      {
        '$where': `pin = '${normalizedPin}'`,
        '$order': 'year DESC',
        '$limit': '1'
      }
    )
  ]);

  const currentValue = values.find(v => parseInt(v.year) === currentYear - 1) || values[0];
  const priorValue = values.find(v => parseInt(v.year) === currentYear - 2) || values[1];

  // Get township name from assessed values
  const township = currentValue?.township_name || values[0]?.township_name || '';

  // Check if we have condo data (has bedrooms, sqft, year built)
  const condo = condoCharacteristics.length > 0 ? condoCharacteristics[0] : null;
  const hasCondo = condo && (condo.char_bedrooms || condo.char_unit_sf || condo.char_yrblt);

  if (characteristics.length > 0) {
    // Found in residential dataset
    const prop = characteristics[0];

    // Calculate year built from age (approximate) or use condo data
    const age = parseInt(prop.age);
    const yearBuilt = condo ? parseInt(condo.char_yrblt) : (age ? currentYear - age : null);

    // Combine the data - prefer condo dataset for bedrooms/sqft if available
    const totalBaths = (parseNumber(prop.fbath) || 0) + ((parseNumber(prop.hbath) || 0) * 0.5);

    // For sqft, prefer condo data (calculated from proration if needed)
    let squareFootage = parseInt(prop.bldg_sf);
    if (hasCondo && condo) {
      // First try char_unit_sf directly
      let condoSqft = parseInt(condo.char_unit_sf);

      // If char_unit_sf is not available, calculate from building sqft × proration rate
      if (!condoSqft || condoSqft <= 0) {
        const buildingSf = parseNumber(condo.char_building_sf);
        const prorationRate = parseNumber(condo.tieback_proration_rate) || parseNumber(condo.card_proration_rate);
        if (buildingSf && prorationRate && prorationRate > 0 && prorationRate < 1) {
          condoSqft = Math.round(buildingSf * prorationRate);
        }
      }

      // Use condo sqft if it's reasonable (not 0 and not unrealistically large)
      if (condoSqft && condoSqft > 0 && condoSqft < 10000) {
        squareFootage = condoSqft;
      }
    }

    // For bedrooms, prefer condo data if available
    let bedrooms = parseInt(prop.beds);
    if (hasCondo && condo) {
      const condoBedrooms = parseInt(condo.char_bedrooms);
      if (condoBedrooms !== null) {
        bedrooms = condoBedrooms;
      }
    }

    return {
      pin: normalizedPin,
      pinFormatted: formatPin(normalizedPin),
      address: prop.addr || '',
      city: 'CHICAGO',
      zipCode: '',
      township,
      townshipCode: prop.town_code || currentValue?.township_code || '',
      neighborhood: prop.nbhd || '',
      propertyClass: prop.class || '',
      propertyClassDescription: getPropertyClassDescription(prop.class || ''),
      yearBuilt,
      squareFootage,
      lotSize: parseInt(prop.hd_sf),
      bedrooms,
      bathrooms: totalBaths || null,
      exteriorConstruction: prop.ext_wall || null,
      basementType: prop.bsmt || null,
      garageType: prop.gar1_size || null,
      assessmentYear: parseInt(prop.tax_year) || currentYear - 1,
      assessedValue: parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot) ||
                     parseNumber(values[0]?.board_tot) || parseNumber(values[0]?.certified_tot) || parseNumber(values[0]?.mailed_tot),
      marketValue: (parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot) ||
                    parseNumber(values[0]?.board_tot) || parseNumber(values[0]?.certified_tot) || parseNumber(values[0]?.mailed_tot) || 0) * 10,
      priorAssessedValue: parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot),
      priorMarketValue: (parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot) || 0) * 10,
      ...calculateAssessmentChange(
        parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot) ||
          parseNumber(values[0]?.board_tot) || parseNumber(values[0]?.certified_tot) || parseNumber(values[0]?.mailed_tot),
        parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot)
      ),
    };
  }

  // Not found in residential dataset - check if we have condo data from the parallel query
  if (!condo) {
    // Not found in either dataset
    // If we have assessed values, we can still return basic info
    if (values.length > 0) {
      console.log(`Property ${normalizedPin} not in characteristics datasets, using assessed values only`);
      return {
        pin: normalizedPin,
        pinFormatted: formatPin(normalizedPin),
        address: '', // No address available from assessed values
        city: 'CHICAGO',
        zipCode: '',
        township,
        townshipCode: currentValue?.township_code || '',
        neighborhood: currentValue?.nbhd || '',
        propertyClass: currentValue?.class || '',
        propertyClassDescription: getPropertyClassDescription(currentValue?.class || ''),
        yearBuilt: null,
        squareFootage: null,
        lotSize: null,
        bedrooms: null,
        bathrooms: null,
        exteriorConstruction: null,
        basementType: null,
        garageType: null,
        assessmentYear: parseInt(currentValue?.year) || currentYear - 1,
        assessedValue: parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot),
        marketValue: (parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot) || 0) * 10,
        priorAssessedValue: parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot),
        priorMarketValue: (parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot) || 0) * 10,
        ...calculateAssessmentChange(
          parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot),
          parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot)
        ),
      };
    }
    return null;
  }

  // Found in condo dataset (but not in residential)

  // Calculate unit square footage:
  // 1. Use char_unit_sf if available
  // 2. Otherwise, estimate from proration_rate × building_sf
  let unitSquareFootage = parseInt(condo.char_unit_sf);
  if (!unitSquareFootage || unitSquareFootage <= 0) {
    const buildingSf = parseNumber(condo.char_building_sf);
    const prorationRate = parseNumber(condo.tieback_proration_rate) || parseNumber(condo.card_proration_rate);
    if (buildingSf && prorationRate && prorationRate > 0 && prorationRate < 1) {
      unitSquareFootage = Math.round(buildingSf * prorationRate);
    }
  }

  // Calculate bathrooms from full + half baths
  const fullBaths = parseNumber(condo.char_full_baths) || 0;
  const halfBaths = parseNumber(condo.char_half_baths) || 0;
  const totalBaths = fullBaths + (halfBaths * 0.5);

  return {
    pin: normalizedPin,
    pinFormatted: formatPin(normalizedPin),
    address: '', // Condo dataset doesn't have address, would need separate lookup
    city: 'CHICAGO',
    zipCode: '',
    township,
    townshipCode: condo.township_code || currentValue?.township_code || '',
    neighborhood: currentValue?.nbhd || '',
    propertyClass: condo.class || '299', // Condos are typically class 299
    propertyClassDescription: getPropertyClassDescription(condo.class || '299'),
    yearBuilt: parseInt(condo.char_yrblt),
    squareFootage: unitSquareFootage || null,
    lotSize: parseInt(condo.char_land_sf),
    bedrooms: parseInt(condo.char_bedrooms),
    bathrooms: totalBaths || null,
    exteriorConstruction: null,
    basementType: null,
    garageType: null,
    assessmentYear: parseInt(condo.year) || currentYear - 1,
    assessedValue: parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot),
    marketValue: (parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot) || 0) * 10,
    priorAssessedValue: parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot),
    priorMarketValue: (parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot) || 0) * 10,
    ...calculateAssessmentChange(
      parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot),
      parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot)
    ),
  };
}

/**
 * Search for properties by address
 */
export async function searchPropertiesByAddress(
  address: string,
  city: string = 'CHICAGO',
  limit: number = 10
): Promise<NormalizedProperty[]> {
  // Clean up address for search
  const cleanAddress = address.toUpperCase().trim();

  const characteristics = await querySODA<PropertyCharacteristics>(
    DATASETS.CHARACTERISTICS,
    {
      '$where': `upper(addr) like '%${cleanAddress}%'`,
      '$order': 'tax_year DESC',
      '$limit': String(limit * 2) // Get more to filter duplicates
    }
  );

  // Group by PIN and take most recent
  const byPin = new Map<string, PropertyCharacteristics>();
  for (const prop of characteristics) {
    if (!byPin.has(prop.pin)) {
      byPin.set(prop.pin, prop);
    }
  }

  // Get assessed values for all found PINs
  const pins = Array.from(byPin.keys()).slice(0, limit);
  if (pins.length === 0) return [];

  const pinList = pins.map(p => `'${p}'`).join(',');
  const values = await querySODA<AssessedValue>(
    DATASETS.ASSESSED_VALUES,
    {
      '$where': `pin in (${pinList})`,
      '$order': 'year DESC'
    }
  );

  // Group values by PIN
  const valuesByPin = new Map<string, AssessedValue[]>();
  for (const val of values) {
    if (!valuesByPin.has(val.pin)) {
      valuesByPin.set(val.pin, []);
    }
    valuesByPin.get(val.pin)!.push(val);
  }

  // Build normalized properties
  const results: NormalizedProperty[] = [];
  const currentYear = new Date().getFullYear();

  for (const entry of Array.from(byPin.entries())) {
    const [pin, prop] = entry;
    const propValues = valuesByPin.get(pin) || [];
    const currentValue = propValues[0];
    const priorValue = propValues[1];

    const totalBaths = (parseNumber(prop.fbath) || 0) + ((parseNumber(prop.hbath) || 0) * 0.5);
    const age = parseInt(prop.age);
    const yearBuilt = age ? currentYear - age : null;
    const township = currentValue?.township_name || '';

    results.push({
      pin,
      pinFormatted: formatPin(pin),
      address: prop.addr || '',
      city: 'CHICAGO',
      zipCode: '',
      township,
      townshipCode: prop.town_code || currentValue?.township_code || '',
      neighborhood: prop.nbhd || '',
      propertyClass: prop.class || '',
      propertyClassDescription: getPropertyClassDescription(prop.class || ''),
      yearBuilt,
      squareFootage: parseInt(prop.bldg_sf),
      lotSize: parseInt(prop.hd_sf),
      bedrooms: parseInt(prop.beds),
      bathrooms: totalBaths || null,
      exteriorConstruction: prop.ext_wall || null,
      basementType: prop.bsmt || null,
      garageType: prop.gar1_size || null,
      assessmentYear: parseInt(prop.tax_year) || currentYear - 1,
      assessedValue: parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot),
      marketValue: (parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot) || 0) * 10,
      priorAssessedValue: parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot),
      priorMarketValue: (parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot) || 0) * 10,
      ...calculateAssessmentChange(
        parseNumber(currentValue?.board_tot) || parseNumber(currentValue?.certified_tot) || parseNumber(currentValue?.mailed_tot),
        parseNumber(priorValue?.board_tot) || parseNumber(priorValue?.certified_tot) || parseNumber(priorValue?.mailed_tot)
      ),
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Get comparable properties for a subject property
 * Handles both residential and condo properties
 */
export async function getComparableProperties(
  subjectProperty: NormalizedProperty,
  limit: number = 10
): Promise<ComparableProperty[]> {
  const currentYear = new Date().getFullYear();
  const sqft = subjectProperty.squareFootage || 1500;
  const minSqft = Math.floor(sqft * 0.70); // 30% tolerance for condos
  const maxSqft = Math.ceil(sqft * 1.30);

  // Check if this is a condo (class 299 or 399, or PIN pattern suggests condo)
  const isCondo = subjectProperty.propertyClass === '299' ||
                  subjectProperty.propertyClass === '399' ||
                  subjectProperty.propertyClassDescription?.toLowerCase().includes('condo');

  if (isCondo) {
    // For condos, search in the condo dataset
    // KEY CRITERIA for property tax appeal comparables:
    // 1. Same bedroom count (most important - 1BR vs 2BR are not comparable)
    // 2. Similar square footage (within 30%)
    // 3. Same township (same assessment jurisdiction)
    // 4. Similar age (within 15 years)
    // 5. Same building is ideal but not required

    const subjectBedrooms = subjectProperty.bedrooms; // Don't default - use actual value
    const buildingPin10 = subjectProperty.pin.slice(0, 10);
    const yearBuilt = subjectProperty.yearBuilt || 1980;
    const minYearBuilt = yearBuilt - 15;
    const maxYearBuilt = yearBuilt + 15;

    console.log(`Searching for condo comparables: township=${subjectProperty.townshipCode}, bedrooms=${subjectBedrooms}, sqft=${sqft} (${minSqft}-${maxSqft}), yearBuilt=${yearBuilt}`);

    // Strategy: Run targeted queries in parallel, then merge and score results
    // Query by specific criteria to avoid timeout on broad township searches
    const queries: Promise<CondoCharacteristics[]>[] = [];

    // Query 1: Same building - BEST comparables (always include)
    queries.push(querySODA<CondoCharacteristics>(
      DATASETS.CONDO_CHARACTERISTICS,
      {
        '$where': `pin10 = '${buildingPin10}'
          AND pin != '${subjectProperty.pin}'
          AND is_parking_space = false
          AND is_common_area = false`,
        '$order': 'year DESC',
        '$limit': '50'
      }
    ));

    // Query 2: Same township + same bedrooms + similar size
    // This is the most important query for finding true comparables
    if (subjectBedrooms !== null && subjectBedrooms !== undefined) {
      // Use proration rate as proxy for size since char_unit_sf is often missing
      // Your property: proration ~0.11, so look for 0.08-0.14 range
      const subjectProration = subjectProperty.squareFootage && subjectProperty.squareFootage > 0
        ? subjectProperty.squareFootage / 5000 // Rough estimate assuming avg building is 5000 sqft
        : 0.12; // Default assumption
      const minProration = Math.max(0.05, subjectProration * 0.6);
      const maxProration = Math.min(0.5, subjectProration * 1.5);

      queries.push(querySODA<CondoCharacteristics>(
        DATASETS.CONDO_CHARACTERISTICS,
        {
          '$where': `township_code = '${subjectProperty.townshipCode}'
            AND pin != '${subjectProperty.pin}'
            AND pin10 != '${buildingPin10}'
            AND is_parking_space = false
            AND is_common_area = false
            AND char_bedrooms = '${subjectBedrooms}'
            AND tieback_proration_rate >= '${minProration.toFixed(3)}'
            AND tieback_proration_rate <= '${maxProration.toFixed(3)}'`,
          '$order': 'year DESC',
          '$limit': '100'
        }
      ));

      // Query 3: Same township + same bedrooms only (backup if size filter too restrictive)
      queries.push(querySODA<CondoCharacteristics>(
        DATASETS.CONDO_CHARACTERISTICS,
        {
          '$where': `township_code = '${subjectProperty.townshipCode}'
            AND pin != '${subjectProperty.pin}'
            AND pin10 != '${buildingPin10}'
            AND is_parking_space = false
            AND is_common_area = false
            AND char_bedrooms = '${subjectBedrooms}'
            AND char_yrblt >= '${minYearBuilt}'
            AND char_yrblt <= '${maxYearBuilt}'`,
          '$order': 'year DESC',
          '$limit': '75'
        }
      ));

      // Query 4: WIDER SEARCH - Same township + same bedrooms, no year filter
      // This helps find more buildings across the area
      queries.push(querySODA<CondoCharacteristics>(
        DATASETS.CONDO_CHARACTERISTICS,
        {
          '$where': `township_code = '${subjectProperty.townshipCode}'
            AND pin != '${subjectProperty.pin}'
            AND pin10 != '${buildingPin10}'
            AND is_parking_space = false
            AND is_common_area = false
            AND char_bedrooms = '${subjectBedrooms}'`,
          '$order': 'year DESC',
          '$limit': '150'
        }
      ));
    }

    // Query 5: ADJACENT TOWNSHIPS - Same bedrooms, similar size
    // Lincoln Park (70) is adjacent to Lake View (76), etc.
    // This widens the search significantly for appeal comparables
    const adjacentTownships = getAdjacentTownships(subjectProperty.townshipCode);
    if (adjacentTownships.length > 0 && subjectBedrooms !== null) {
      const townshipList = adjacentTownships.map(t => `'${t}'`).join(',');
      queries.push(querySODA<CondoCharacteristics>(
        DATASETS.CONDO_CHARACTERISTICS,
        {
          '$where': `township_code in (${townshipList})
            AND pin != '${subjectProperty.pin}'
            AND is_parking_space = false
            AND is_common_area = false
            AND char_bedrooms = '${subjectBedrooms}'`,
          '$order': 'year DESC',
          '$limit': '100'
        }
      ));
    }

    // Run all queries in parallel with individual error handling
    const results = await Promise.allSettled(queries);
    const allCondos: CondoCharacteristics[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allCondos.push(...result.value);
      } else {
        console.warn('Condo comparable query failed:', result.reason?.message || result.reason);
      }
    }

    console.log(`Found ${allCondos.length} potential condo comparables before filtering`);

    // Group by PIN, keeping most recent
    const byPin = new Map<string, CondoCharacteristics>();
    for (const prop of allCondos) {
      if (!byPin.has(prop.pin)) {
        byPin.set(prop.pin, prop);
      }
    }

    const pins = Array.from(byPin.keys()).slice(0, limit * 3);
    if (pins.length === 0) {
      console.log(`No condo comparables found for ${subjectProperty.pin}`);
      return [];
    }

    // Get assessed values for these condos
    const pinList = pins.map(p => `'${p}'`).join(',');
    const values = await querySODA<AssessedValue>(
      DATASETS.ASSESSED_VALUES,
      {
        '$where': `pin in (${pinList})`,
        '$order': 'year DESC'
      }
    );

    // Group values by PIN
    const valuesByPin = new Map<string, AssessedValue>();
    for (const val of values) {
      if (!valuesByPin.has(val.pin)) {
        valuesByPin.set(val.pin, val);
      }
    }

    // Build comparables with similarity scoring
    const comparables: (ComparableProperty & { similarityScore: number })[] = [];

    for (const [pin, condo] of Array.from(byPin.entries())) {
      const propValue = valuesByPin.get(pin);
      if (!propValue) continue;

      // Calculate unit sqft - use char_unit_sf if available, otherwise estimate from proration
      let compSqft = parseInt(condo.char_unit_sf);
      if (!compSqft || compSqft <= 0) {
        const buildingSf = parseNumber(condo.char_building_sf);
        const prorationRate = parseNumber(condo.tieback_proration_rate) || parseNumber(condo.card_proration_rate);
        if (buildingSf && prorationRate && prorationRate > 0 && prorationRate < 1) {
          compSqft = Math.round(buildingSf * prorationRate);
        }
      }

      const compBedrooms = parseInt(condo.char_bedrooms);
      const compYearBuilt = parseInt(condo.char_yrblt);
      const compValue = parseNumber(propValue.board_tot) || parseNumber(propValue.certified_tot) || parseNumber(propValue.mailed_tot);

      // Skip if no assessed value
      if (!compValue) continue;

      const sqftDiff = compSqft && sqft ? ((compSqft - sqft) / sqft) * 100 : null;
      const ageDiff = compYearBuilt && yearBuilt ? compYearBuilt - yearBuilt : null;
      const valuePerSqft = compValue && compSqft ? compValue / compSqft : null;

      // FILTER: Skip properties with wrong bedroom count
      // For property tax appeals, comparing 1BR to 2BR is not valid
      if (subjectBedrooms !== null && subjectBedrooms !== undefined &&
          compBedrooms !== null && !isNaN(compBedrooms) &&
          compBedrooms !== subjectBedrooms) {
        // Only allow ±1 bedroom difference, and heavily penalize
        if (Math.abs(compBedrooms - subjectBedrooms) > 1) {
          continue; // Skip entirely - too different
        }
      }

      // NOTE: We no longer hard-filter on sqft difference
      // Instead, we use $/sqft normalization to make units of different sizes comparable
      // A 600 sqft unit at $28/sqft IS comparable to a 900 sqft unit at $25/sqft
      // The key insight: per-sqft assessment rates should be similar for similar quality units
      // Sqft difference will affect similarity score but won't exclude units

      // Calculate similarity score (higher = more similar)
      // Base score starts at 100
      let similarityScore = 100;

      // Same building bonus - REDUCED from 50 to 20
      // We want to find comparables in OTHER buildings too, not just same building
      // Same building is good for similarity but doesn't help appeals if all units
      // are assessed at the same $/sqft rate
      if (condo.pin10 === buildingPin10) {
        similarityScore += 20;
      }

      // Bedroom match is critical
      // Same bedrooms: +20 points, Different: -40 points per bedroom
      if (compBedrooms === subjectBedrooms) {
        similarityScore += 20;
      } else if (compBedrooms !== null && !isNaN(compBedrooms) &&
                 subjectBedrooms !== null && subjectBedrooms !== undefined) {
        similarityScore -= 40 * Math.abs(compBedrooms - subjectBedrooms);
      }

      // Square footage similarity
      // We use $/sqft normalization, so size difference is less critical
      // But still give bonus for similar sizes (more defensible comparables)
      if (sqftDiff !== null) {
        if (Math.abs(sqftDiff) <= 15) {
          similarityScore += 10; // Within 15% is good
        } else if (Math.abs(sqftDiff) <= 30) {
          similarityScore += 5; // Within 30% is acceptable
        } else if (Math.abs(sqftDiff) <= 50) {
          // Still include but slight penalty
          similarityScore -= 5;
        } else {
          // Large difference - still include but more penalty
          similarityScore -= 10;
        }
      }

      // IMPORTANT: Same neighborhood is VERY valuable for appeals
      // The assessor's own methodology uses neighborhood as a key factor
      // Same neighborhood: +25 points (increased from 10)
      if (propValue.nbhd === subjectProperty.neighborhood) {
        similarityScore += 25;
      }

      // Year built similarity (-0.3 point per year difference, max -10)
      // Relaxed from -0.5 because age is less critical than location
      if (ageDiff !== null) {
        similarityScore -= Math.min(10, Math.abs(ageDiff) * 0.3);
      }

      // APPEAL STRATEGY: Significant bonus for units assessed LOWER per sqft
      // These comparables support our appeal argument - they show inconsistency
      // The bigger the gap, the more valuable this comparable is for the appeal
      const subjectAssessedValue = subjectProperty.assessedValue;
      const subjectValuePerSqft = subjectAssessedValue && sqft && sqft > 0 ? subjectAssessedValue / sqft : null;
      if (valuePerSqft && subjectValuePerSqft && valuePerSqft < subjectValuePerSqft) {
        const percentLower = ((subjectValuePerSqft - valuePerSqft) / subjectValuePerSqft) * 100;
        // INCREASED: Add up to 30 bonus points for comparables assessed significantly lower
        // This ensures lower-assessed comps from other buildings can compete with same-building comps
        similarityScore += Math.min(30, percentLower * 1.0);
      }

      // Extract unit number from PIN for display
      // Cook County condo PINs: last 4 digits typically represent unit (1XXX = unit XXX)
      const unitSuffix = pin.slice(-4);
      const unitNumber = unitSuffix.startsWith('1') ? unitSuffix.slice(1).replace(/^0+/, '') : unitSuffix.replace(/^0+/, '');
      const isSameBuilding = condo.pin10 === buildingPin10;

      // Create a descriptive address for the comparable
      let compAddress = '';
      if (isSameBuilding) {
        compAddress = `Same Building - Unit ${unitNumber || 'N/A'}`;
      } else {
        // For other buildings, show township + unit
        compAddress = `${propValue.township_name || 'Cook County'} - Unit ${unitNumber || 'N/A'}`;
      }

      comparables.push({
        pin,
        pinFormatted: formatPin(pin),
        address: compAddress,
        city: 'CHICAGO',
        zipCode: '',
        township: propValue.township_name || '',
        townshipCode: condo.township_code || propValue.township_code || '',
        neighborhood: propValue.nbhd || '',
        propertyClass: condo.class || '299',
        propertyClassDescription: getPropertyClassDescription(condo.class || '299'),
        yearBuilt: compYearBuilt,
        squareFootage: compSqft,
        lotSize: parseInt(condo.char_land_sf),
        bedrooms: compBedrooms,
        bathrooms: null, // Not in condo dataset unfortunately
        exteriorConstruction: null,
        basementType: null,
        garageType: null,
        assessmentYear: parseInt(condo.year) || currentYear - 1,
        assessedValue: compValue,
        marketValue: (compValue || 0) * 10,
        priorAssessedValue: null,
        priorMarketValue: null,
        assessmentChangeDollars: null,
        assessmentChangePercent: null,
        distanceMiles: null,
        salePrice: null,
        saleDate: null,
        valuePerSqft,
        sqftDifferencePct: sqftDiff,
        ageDifferenceYears: ageDiff,
        similarityScore,
      });
    }

    // Sort by similarity score (highest first)
    comparables.sort((a, b) => b.similarityScore - a.similarityScore);

    // BALANCED SELECTION: Ensure mix of same-building and other-building comparables
    // This provides both legitimacy (same building) and appeal strength (lower-assessed others)
    const sameBuildingComps = comparables.filter(c => c.address.includes('Same Building'));
    const otherBuildingComps = comparables.filter(c => !c.address.includes('Same Building'));

    // Take up to 3 from same building, rest from other buildings
    const maxSameBuilding = Math.min(3, sameBuildingComps.length);
    const maxOtherBuilding = limit - maxSameBuilding;

    const selectedComps = [
      ...sameBuildingComps.slice(0, maxSameBuilding),
      ...otherBuildingComps.slice(0, maxOtherBuilding)
    ];

    // Re-sort the selected comparables by similarity score
    selectedComps.sort((a, b) => b.similarityScore - a.similarityScore);

    console.log(`Returning ${selectedComps.length} comparables: ${maxSameBuilding} same-building, ${Math.min(maxOtherBuilding, otherBuildingComps.length)} other-building`);

    // Return top comparables, removing the similarityScore field
    return selectedComps.slice(0, limit).map(({ similarityScore, ...comp }) => comp);
  }

  // For non-condos, use original residential search logic
  const yearBuilt = subjectProperty.yearBuilt || 1960;

  // Calculate age range for comparison
  const subjectAge = subjectProperty.yearBuilt ? currentYear - subjectProperty.yearBuilt : 50;
  const minAge = Math.max(0, subjectAge - 10);
  const maxAge = subjectAge + 10;

  // Query for comparables from residential dataset
  const characteristics = await querySODA<PropertyCharacteristics>(
    DATASETS.CHARACTERISTICS,
    {
      '$where': `nbhd = '${subjectProperty.neighborhood}'
        AND class = '${subjectProperty.propertyClass}'
        AND pin != '${subjectProperty.pin}'
        AND bldg_sf >= '${minSqft}' AND bldg_sf <= '${maxSqft}'
        AND age >= '${minAge}' AND age <= '${maxAge}'`,
      '$order': 'tax_year DESC',
      '$limit': String(limit * 3)
    }
  );

  // Group by PIN, get most recent
  const byPin = new Map<string, PropertyCharacteristics>();
  for (const prop of characteristics) {
    if (!byPin.has(prop.pin)) {
      byPin.set(prop.pin, prop);
    }
  }

  const pins = Array.from(byPin.keys()).slice(0, limit * 2);
  if (pins.length === 0) return [];

  // Get values and sales for these properties
  const pinList = pins.map(p => `'${p}'`).join(',');

  const [values, sales] = await Promise.all([
    querySODA<AssessedValue>(
      DATASETS.ASSESSED_VALUES,
      {
        '$where': `pin in (${pinList})`,
        '$order': 'year DESC'
      }
    ),
    querySODA<SaleRecord>(
      DATASETS.SALES_ARCHIVED,
      {
        '$where': `pin in (${pinList}) AND sale_price > '50000'`,
        '$order': 'sale_date DESC'
      }
    )
  ]);

  // Group by PIN
  const valuesByPin = new Map<string, AssessedValue>();
  for (const val of values) {
    if (!valuesByPin.has(val.pin)) {
      valuesByPin.set(val.pin, val);
    }
  }

  const salesByPin = new Map<string, SaleRecord>();
  for (const sale of sales) {
    if (!salesByPin.has(sale.pin)) {
      salesByPin.set(sale.pin, sale);
    }
  }

  // Build comparables
  const comparables: ComparableProperty[] = [];

  for (const entry of Array.from(byPin.entries())) {
    const [pin, prop] = entry;
    const propValue = valuesByPin.get(pin);
    const propSale = salesByPin.get(pin);

    if (!propValue) continue;

    const compSqft = parseInt(prop.bldg_sf);
    const compAge = parseInt(prop.age);
    const compYearBuilt = compAge ? currentYear - compAge : null;
    const compValue = parseNumber(propValue.board_tot) || parseNumber(propValue.certified_tot) || parseNumber(propValue.mailed_tot);
    const totalBaths = (parseNumber(prop.fbath) || 0) + ((parseNumber(prop.hbath) || 0) * 0.5);

    const sqftDiff = compSqft && sqft ? ((compSqft - sqft) / sqft) * 100 : null;
    const ageDiff = compYearBuilt && yearBuilt ? compYearBuilt - yearBuilt : null;
    const valuePerSqft = compValue && compSqft ? compValue / compSqft : null;

    comparables.push({
      pin,
      pinFormatted: formatPin(pin),
      address: prop.addr || '',
      city: 'CHICAGO',
      zipCode: '',
      township: propValue.township_name || '',
      townshipCode: prop.town_code || propValue.township_code || '',
      neighborhood: prop.nbhd || '',
      propertyClass: prop.class || '',
      propertyClassDescription: getPropertyClassDescription(prop.class || ''),
      yearBuilt: compYearBuilt,
      squareFootage: compSqft,
      lotSize: parseInt(prop.hd_sf),
      bedrooms: parseInt(prop.beds),
      bathrooms: totalBaths || null,
      exteriorConstruction: prop.ext_wall || null,
      basementType: prop.bsmt || null,
      garageType: prop.gar1_size || null,
      assessmentYear: parseInt(prop.tax_year) || currentYear - 1,
      assessedValue: compValue,
      marketValue: (compValue || 0) * 10,
      priorAssessedValue: null,
      priorMarketValue: null,
      assessmentChangeDollars: null,
      assessmentChangePercent: null,
      distanceMiles: null, // Would need geocoding
      salePrice: parseNumber(propSale?.sale_price),
      saleDate: propSale?.sale_date || null,
      valuePerSqft,
      sqftDifferencePct: sqftDiff,
      ageDifferenceYears: ageDiff,
    });

    if (comparables.length >= limit) break;
  }

  // Sort by value per sqft (closest to subject)
  const subjectValuePerSqft = subjectProperty.assessedValue && subjectProperty.squareFootage
    ? subjectProperty.assessedValue / subjectProperty.squareFootage
    : null;

  if (subjectValuePerSqft) {
    comparables.sort((a, b) => {
      const aDiff = Math.abs((a.valuePerSqft || 0) - subjectValuePerSqft);
      const bDiff = Math.abs((b.valuePerSqft || 0) - subjectValuePerSqft);
      return aDiff - bDiff;
    });
  }

  return comparables.slice(0, limit);
}

/**
 * Get Board of Review appeal history for a property
 */
export async function getAppealHistory(pin: string): Promise<BORDecision[]> {
  const normalizedPin = normalizePin(pin);

  const decisions = await querySODA<BORDecision>(
    DATASETS.BOR_DECISIONS,
    {
      '$where': `pin = '${normalizedPin}'`,
      '$order': 'tax_year DESC',
      '$limit': '10'
    }
  );

  return decisions;
}

/**
 * Get township win rate statistics from Board of Review decisions
 * Returns success rate and average reduction for similar properties
 */
export interface TownshipWinRate {
  township: string;
  totalAppeals: number;
  successfulAppeals: number;
  winRate: number;
  avgReductionPercent: number;
  avgReductionDollars: number;
  dataYears: string[];
}

export async function getTownshipWinRate(
  townshipCode: string,
  propertyClass?: string
): Promise<TownshipWinRate | null> {
  try {
    // Query BOR decisions for this township over last 3 years
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 3;

    let whereClause = `township_code = '${townshipCode}' AND tax_year >= '${startYear}'`;
    if (propertyClass) {
      whereClause += ` AND class = '${propertyClass}'`;
    }

    const decisions = await querySODA<BORDecision>(
      DATASETS.BOR_DECISIONS,
      {
        '$where': whereClause,
        '$limit': '5000'
      }
    );

    if (decisions.length === 0) {
      return null;
    }

    // Calculate statistics
    let successfulAppeals = 0;
    let totalReductionPercent = 0;
    let totalReductionDollars = 0;
    const years = new Set<string>();

    for (const decision of decisions) {
      years.add(decision.tax_year);

      // A successful appeal is one where the value was reduced
      const preMktVal = parseFloat(decision.tot_pre_mktval) || 0;
      const postMktVal = parseFloat(decision.tot_post_mktval) || 0;

      if (postMktVal < preMktVal && preMktVal > 0) {
        successfulAppeals++;
        const reduction = preMktVal - postMktVal;
        const reductionPct = (reduction / preMktVal) * 100;
        totalReductionPercent += reductionPct;
        totalReductionDollars += reduction;
      }
    }

    const winRate = (successfulAppeals / decisions.length) * 100;
    const avgReductionPercent = successfulAppeals > 0 ? totalReductionPercent / successfulAppeals : 0;
    const avgReductionDollars = successfulAppeals > 0 ? totalReductionDollars / successfulAppeals : 0;

    return {
      township: townshipCode,
      totalAppeals: decisions.length,
      successfulAppeals,
      winRate: Math.round(winRate * 10) / 10,
      avgReductionPercent: Math.round(avgReductionPercent * 10) / 10,
      avgReductionDollars: Math.round(avgReductionDollars),
      dataYears: Array.from(years).sort().reverse()
    };
  } catch (error) {
    console.error('Error fetching township win rate:', error);
    return null;
  }
}

/**
 * Get prior appeal history for a specific PIN with outcomes
 */
export interface PriorAppealOutcome {
  taxYear: string;
  preAppealValue: number;
  postAppealValue: number;
  reduction: number;
  reductionPercent: number;
  success: boolean;
  reason: string;
}

export async function getPriorAppealOutcomes(pin: string): Promise<PriorAppealOutcome[]> {
  const decisions = await getAppealHistory(pin);

  return decisions.map(d => {
    const preVal = parseFloat(d.tot_pre_mktval) || 0;
    const postVal = parseFloat(d.tot_post_mktval) || 0;
    const reduction = preVal - postVal;
    const reductionPct = preVal > 0 ? (reduction / preVal) * 100 : 0;

    return {
      taxYear: d.tax_year,
      preAppealValue: preVal,
      postAppealValue: postVal,
      reduction: reduction,
      reductionPercent: Math.round(reductionPct * 10) / 10,
      success: reduction > 0,
      reason: d.reason || ''
    };
  });
}

/**
 * Get assessment history for a property
 */
export async function getAssessmentHistory(pin: string, years: number = 5): Promise<AssessedValue[]> {
  const normalizedPin = normalizePin(pin);

  const values = await querySODA<AssessedValue>(
    DATASETS.ASSESSED_VALUES,
    {
      '$where': `pin = '${normalizedPin}'`,
      '$order': 'year DESC',
      '$limit': String(years)
    }
  );

  return values;
}

/**
 * Analyze appeal opportunity for a property
 */
export async function analyzeAppealOpportunity(
  pin: string
): Promise<AppealOpportunity | null> {
  // Get property data
  const property = await getPropertyByPin(pin);
  if (!property) {
    return null;
  }

  // Get comparables, sales, and appeal history in parallel for performance
  const [comparables, comparableSales, appealHistory] = await Promise.all([
    getComparableProperties(property, 15),
    getComparableSales(property, 10),
    getAppealHistory(pin),
  ]);

  // Calculate analysis using the pure scoring function
  const compValues = comparables
    .map(c => c.assessedValue)
    .filter((v): v is number => v !== null);

  const subjectValue = property.assessedValue || 0;
  const subjectSqft = property.squareFootage || 0;

  // Calculate per-sqft analysis - THIS IS CRITICAL for fair comparisons
  // Comparing a 600 sqft unit to a 1200 sqft unit by total value is misleading
  // $/sqft is the true apples-to-apples comparison
  let perSqftAnalysis: AppealOpportunity['analysis']['perSqftAnalysis'];
  if (subjectSqft > 0 && subjectValue > 0) {
    const subjectValuePerSqft = subjectValue / subjectSqft;

    // Get comparables with valid sqft data
    const comparablesWithSqft = comparables.filter(c =>
      c.squareFootage && c.squareFootage > 0 &&
      c.assessedValue && c.assessedValue > 0
    );

    if (comparablesWithSqft.length >= 3) {
      const valuesPerSqft = comparablesWithSqft
        .map(c => (c.assessedValue! / c.squareFootage!))
        .sort((a, b) => a - b);

      const medianValuePerSqft = valuesPerSqft[Math.floor(valuesPerSqft.length / 2)];
      const avgValuePerSqft = valuesPerSqft.reduce((a, b) => a + b, 0) / valuesPerSqft.length;

      // Calculate how much subject differs from median $/sqft
      const percentDiff = ((subjectValuePerSqft - medianValuePerSqft) / medianValuePerSqft) * 100;

      // What should the subject be valued at based on median $/sqft?
      const impliedFairValue = Math.round(subjectSqft * medianValuePerSqft);
      const overvaluationBasedOnSqft = subjectValue - impliedFairValue;

      perSqftAnalysis = {
        subjectValuePerSqft: Math.round(subjectValuePerSqft * 100) / 100,
        medianComparableValuePerSqft: Math.round(medianValuePerSqft * 100) / 100,
        averageComparableValuePerSqft: Math.round(avgValuePerSqft * 100) / 100,
        percentDifferenceFromMedian: Math.round(percentDiff * 10) / 10,
        comparablesWithSqftData: comparablesWithSqft.length,
        impliedFairValue,
        overvaluationBasedOnSqft: Math.round(overvaluationBasedOnSqft),
      };
    }
  }

  // Check if property has had recent successful appeals
  const hasRecentSuccess = appealHistory.some(
    a => a.change && parseNumber(a.tot_post_mktval) && parseNumber(a.tot_pre_mktval) &&
    parseNumber(a.tot_post_mktval)! < parseNumber(a.tot_pre_mktval)!
  );

  // Prepare enhanced scoring inputs
  const compSqfts = comparables.map(c => c.squareFootage);
  const compCharacteristics = comparables.map(c => ({
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    yearBuilt: c.yearBuilt,
    stories: null as number | null, // Not always available
  }));

  // Use the enhanced pure scoring function
  const scoringResult = calculateOpportunityScore({
    subjectValue,
    comparableValues: compValues,
    hasRecentAppealSuccess: hasRecentSuccess,
    assessmentChangePercent: property.assessmentChangePercent,
    // NEW: Pass enhanced data for expanded scoring
    subjectSquareFootage: subjectSqft,
    comparableSquareFootages: compSqfts,
    subjectCharacteristics: {
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      yearBuilt: property.yearBuilt,
      stories: null,
    },
    comparableCharacteristics: compCharacteristics,
    // Historical assessments would need separate API call - skip for now
    // neighborhoodChangePercent would need separate calculation - skip for now
  });

  // Add per-sqft appeal ground if applicable (now that we have scoringResult)
  if (perSqftAnalysis && perSqftAnalysis.percentDifferenceFromMedian > 15) {
    if (!scoringResult.appealGrounds.includes('value_per_sqft')) {
      scoringResult.appealGrounds.push('value_per_sqft');
    }
  }

  // Calculate sales-based analysis
  // This is the strongest evidence: "These sold for $X. My assessment implies $Y."
  let salesAnalysis: AppealOpportunity['analysis']['salesAnalysis'];
  if (comparableSales.length >= 3) {
    const salePrices = comparableSales.map(s => s.salePrice).sort((a, b) => a - b);
    const pricesPerSqft = comparableSales
      .filter(s => s.pricePerSqft !== null)
      .map(s => s.pricePerSqft as number)
      .sort((a, b) => a - b);

    const medianSalePrice = salePrices[Math.floor(salePrices.length / 2)];
    const averageSalePrice = salePrices.reduce((a, b) => a + b, 0) / salePrices.length;
    const medianPricePerSqft = pricesPerSqft.length > 0
      ? pricesPerSqft[Math.floor(pricesPerSqft.length / 2)]
      : 0;

    // Calculate implied value based on subject's sqft and median price/sqft
    const subjectSqft = property.squareFootage || 800;
    const impliedMarketValue = medianPricePerSqft > 0
      ? Math.round(subjectSqft * medianPricePerSqft)
      : medianSalePrice;

    // In Cook County, assessed value = market value / 10
    const subjectImpliedMarketValue = (property.assessedValue || 0) * 10;
    const assessmentVsSalesGap = subjectImpliedMarketValue - impliedMarketValue;
    const overvaluedByPercent = impliedMarketValue > 0
      ? ((subjectImpliedMarketValue - impliedMarketValue) / impliedMarketValue) * 100
      : 0;

    salesAnalysis = {
      medianSalePrice: Math.round(medianSalePrice),
      averageSalePrice: Math.round(averageSalePrice),
      medianPricePerSqft: Math.round(medianPricePerSqft),
      salesCount: comparableSales.length,
      impliedMarketValue,
      assessmentVsSalesGap: Math.round(assessmentVsSalesGap),
      overvaluedByPercent: Math.round(overvaluedByPercent * 10) / 10,
    };

    // Add sales-based ground if overvalued by more than 10%
    if (overvaluedByPercent > 10 && !scoringResult.appealGrounds.includes('market_sales')) {
      scoringResult.appealGrounds.push('market_sales');
    }
  }

  // Check prior appeals
  const lastAppeal = appealHistory[0];
  const priorAppeals = {
    hasAppealed: appealHistory.length > 0,
    lastAppealYear: lastAppeal ? parseInt(lastAppeal.tax_year) : null,
    lastAppealResult: lastAppeal?.change || null,
    successRate: appealHistory.length > 0
      ? appealHistory.filter(a =>
          parseNumber(a.tot_post_mktval) && parseNumber(a.tot_pre_mktval) &&
          parseNumber(a.tot_post_mktval)! < parseNumber(a.tot_pre_mktval)!
        ).length / appealHistory.length
      : null
  };

  // ============================================================================
  // THREE-LAYER CREDIBILITY ARCHITECTURE
  // Designed to produce institution-credible analysis that can withstand
  // scrutiny from assessors, review boards, and city officials.
  // ============================================================================

  // ============================================================
  // LAYER 1: MARKET VALUE ANALYSIS
  // Uses median/mean comparable analysis to determine fair market value.
  // This is the primary valuation argument - NOT "pick the lowest."
  // ============================================================
  let marketValueAnalysis: AppealOpportunity['analysis']['marketValueAnalysis'];
  let appealCase: AppealOpportunity['analysis']['appealCase']; // Legacy support

  if (subjectValue > 0 && subjectSqft > 0) {
    const subjectValuePerSqft = subjectValue / subjectSqft;
    const subjectNeighborhood = property.neighborhood;

    // Get all comparables with valid $/sqft data
    const validComps = comparables
      .filter(c => c.squareFootage && c.squareFootage > 0 && c.assessedValue && c.assessedValue > 0)
      .map(c => ({
        ...c,
        valuePerSqft: c.assessedValue! / c.squareFootage!,
        sameNeighborhood: c.neighborhood === subjectNeighborhood,
      }))
      .sort((a, b) => a.valuePerSqft - b.valuePerSqft);

    if (validComps.length >= 5) {
      // Calculate MEDIAN and MEAN - these are our fair value benchmarks
      const valuesPerSqft = validComps.map(c => c.valuePerSqft);
      const sortedValues = [...valuesPerSqft].sort((a, b) => a - b);
      const medianIdx = Math.floor(sortedValues.length / 2);
      const medianValuePerSqft = sortedValues.length % 2 === 0
        ? (sortedValues[medianIdx - 1] + sortedValues[medianIdx]) / 2
        : sortedValues[medianIdx];
      const meanValuePerSqft = valuesPerSqft.reduce((a, b) => a + b, 0) / valuesPerSqft.length;

      // Calculate fair assessed value using median (more robust than mean)
      const fairAssessedValue = Math.round(subjectSqft * medianValuePerSqft);
      const deviationFromMedian = subjectValue - fairAssessedValue;
      const percentAboveMedian = ((subjectValuePerSqft - medianValuePerSqft) / medianValuePerSqft) * 100;

      // Determine confidence based on sample size and consistency
      const stdDev = Math.sqrt(
        valuesPerSqft.reduce((sum, v) => sum + Math.pow(v - meanValuePerSqft, 2), 0) / valuesPerSqft.length
      );
      const coeffOfVariation = stdDev / meanValuePerSqft;
      let confidence: 'high' | 'medium' | 'low';
      if (validComps.length >= 10 && coeffOfVariation < 0.3) {
        confidence = 'high';
      } else if (validComps.length >= 5 && coeffOfVariation < 0.5) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      // Select representative comparables (around the median, not just lowest)
      // This provides a balanced sample that withstands scrutiny
      const targetCount = Math.min(6, validComps.length);
      const medianCompIdx = Math.floor(validComps.length / 2);
      const halfTarget = Math.floor(targetCount / 2);
      const startIdx = Math.max(0, medianCompIdx - halfTarget);
      const representativeComps = validComps.slice(startIdx, startIdx + targetCount);

      // Build professional valuation statement
      let valuationStatement: string;
      if (percentAboveMedian >= 15) {
        valuationStatement = `Analysis of ${validComps.length} comparable properties indicates the subject property's assessment of $${subjectValuePerSqft.toFixed(2)}/sqft exceeds the median comparable rate of $${medianValuePerSqft.toFixed(2)}/sqft by ${percentAboveMedian.toFixed(1)}%. Based on market-comparable assessments, the fair assessed value is $${fairAssessedValue.toLocaleString()}.`;
      } else if (percentAboveMedian >= 5) {
        valuationStatement = `The subject property's assessment of $${subjectValuePerSqft.toFixed(2)}/sqft is ${percentAboveMedian.toFixed(1)}% above the median comparable rate of $${medianValuePerSqft.toFixed(2)}/sqft, suggesting the assessment may exceed fair market-based valuation.`;
      } else {
        valuationStatement = `The subject property's assessment aligns with comparable properties in the market. The median assessment rate is $${medianValuePerSqft.toFixed(2)}/sqft.`;
      }

      marketValueAnalysis = {
        methodology: 'median_comparable',
        fairAssessedValue,
        medianValuePerSqft: Math.round(medianValuePerSqft * 100) / 100,
        meanValuePerSqft: Math.round(meanValuePerSqft * 100) / 100,
        subjectValuePerSqft: Math.round(subjectValuePerSqft * 100) / 100,
        deviationFromMedian,
        percentAboveMedian: Math.round(percentAboveMedian * 10) / 10,
        representativeComparables: representativeComps.map(c => ({
          pin: c.pin,
          pinFormatted: c.pinFormatted,
          address: c.address || '',
          neighborhood: c.neighborhood || '',
          squareFootage: c.squareFootage!,
          bedrooms: c.bedrooms,
          yearBuilt: c.yearBuilt,
          assessedValue: c.assessedValue!,
          valuePerSqft: Math.round(c.valuePerSqft * 100) / 100,
          sameNeighborhood: c.sameNeighborhood,
        })),
        confidence,
        valuationStatement,
      };

      // Add appeal ground if significantly overassessed
      if (percentAboveMedian >= 10 && !scoringResult.appealGrounds.includes('above_market_value')) {
        scoringResult.appealGrounds.push('above_market_value');
      }

      // Legacy appealCase support (for backward compatibility)
      // Uses lower-assessed comps but frames them as equity evidence
      const lowerComps = validComps.filter(c => c.valuePerSqft < subjectValuePerSqft).slice(0, 5);
      if (lowerComps.length >= 3) {
        const avgLowerPerSqft = lowerComps.slice(0, 3).reduce((sum, c) => sum + c.valuePerSqft, 0) / 3;
        const targetAssessedValue = Math.round(subjectSqft * avgLowerPerSqft);
        const requestedReduction = subjectValue - targetAssessedValue;
        const estimatedAnnualSavings = Math.round(requestedReduction * 0.065);
        const sameNeighborhoodCount = lowerComps.filter(c => c.sameNeighborhood).length;

        appealCase = {
          bestComparables: lowerComps.map(c => ({
            pin: c.pin,
            pinFormatted: c.pinFormatted,
            address: c.address || '',
            neighborhood: c.neighborhood || '',
            squareFootage: c.squareFootage!,
            bedrooms: c.bedrooms,
            yearBuilt: c.yearBuilt,
            assessedValue: c.assessedValue!,
            valuePerSqft: Math.round(c.valuePerSqft * 100) / 100,
            percentLowerThanSubject: Math.round(((subjectValuePerSqft - c.valuePerSqft) / subjectValuePerSqft) * 1000) / 10,
            sameNeighborhood: c.sameNeighborhood,
          })),
          targetAssessedValue,
          requestedReduction,
          estimatedAnnualSavings,
          caseStrength: percentAboveMedian >= 15 && sameNeighborhoodCount >= 2 ? 'strong' :
                        percentAboveMedian >= 10 || sameNeighborhoodCount >= 1 ? 'moderate' : 'weak',
          arguments: [
            `${lowerComps.length} comparable properties demonstrate lower assessment rates`,
            `Median market rate of $${medianValuePerSqft.toFixed(2)}/sqft supports fair value of $${fairAssessedValue.toLocaleString()}`,
          ],
        };
      }
    }
  }

  // ============================================================
  // LAYER 2: UNIFORMITY/EQUITY ANALYSIS
  // Detects systematic inconsistencies in assessment practices.
  // Framed as "uniformity" (a legal term) rather than "finding lowest."
  // ============================================================
  let uniformityAnalysis: AppealOpportunity['analysis']['uniformityAnalysis'];
  let equityAnalysis: AppealOpportunity['analysis']['equityAnalysis']; // Legacy support

  if (subjectValue > 0 && subjectSqft > 0 && comparables.length >= 5) {
    const subjectValuePerSqft = subjectValue / subjectSqft;
    const subjectNeighborhood = property.neighborhood;

    // Get all comparables with valid $/sqft
    const allCompsWithSqft = comparables
      .filter(c => c.squareFootage && c.squareFootage > 0 && c.assessedValue && c.assessedValue > 0)
      .map(c => ({
        ...c,
        valuePerSqft: c.assessedValue! / c.squareFootage!,
        sameNeighborhood: c.neighborhood === subjectNeighborhood,
      }));

    if (allCompsWithSqft.length >= 5) {
      const valuesPerSqft = allCompsWithSqft.map(c => c.valuePerSqft);
      const meanValue = valuesPerSqft.reduce((a, b) => a + b, 0) / valuesPerSqft.length;

      // Calculate Coefficient of Dispersion (COD)
      // This is a standard metric used by assessment professionals
      const medianValue = [...valuesPerSqft].sort((a, b) => a - b)[Math.floor(valuesPerSqft.length / 2)];
      const absoluteDeviations = valuesPerSqft.map(v => Math.abs(v - medianValue));
      const avgAbsoluteDeviation = absoluteDeviations.reduce((a, b) => a + b, 0) / absoluteDeviations.length;
      const coefficientOfDispersion = (avgAbsoluteDeviation / medianValue) * 100;

      // Count properties assessed lower
      const propertiesAssessedLower = allCompsWithSqft.filter(c => c.valuePerSqft < subjectValuePerSqft).length;
      const percentileRank = Math.round((propertiesAssessedLower / allCompsWithSqft.length) * 100);

      // Neighborhood-specific metrics
      const neighborhoodComps = allCompsWithSqft.filter(c => c.sameNeighborhood);
      const neighborhoodAvg = neighborhoodComps.length > 0
        ? neighborhoodComps.reduce((sum, c) => sum + c.valuePerSqft, 0) / neighborhoodComps.length
        : meanValue;
      const subjectVsNeighborhood = ((subjectValuePerSqft - neighborhoodAvg) / neighborhoodAvg) * 100;

      // Determine uniformity rating
      // IAAO standards: COD < 15% is ideal for residential
      let uniformityRating: 'consistent' | 'moderate_variation' | 'significant_disparity';
      if (coefficientOfDispersion < 15) {
        uniformityRating = 'consistent';
      } else if (coefficientOfDispersion < 25) {
        uniformityRating = 'moderate_variation';
      } else {
        uniformityRating = 'significant_disparity';
      }

      // Build professional uniformity statement
      let uniformityStatement: string;
      if (percentileRank >= 80) {
        uniformityStatement = `Statistical analysis reveals significant assessment disparity. The subject property is assessed at rates exceeding ${percentileRank}% of comparable properties, indicating potential non-uniformity in assessment practices that warrants review under equal protection principles.`;
      } else if (percentileRank >= 65) {
        uniformityStatement = `The subject property's assessment exceeds ${percentileRank}% of comparable properties. The coefficient of dispersion of ${coefficientOfDispersion.toFixed(1)}% indicates ${uniformityRating === 'significant_disparity' ? 'significant variation' : 'moderate variation'} in assessment practices.`;
      } else if (percentileRank >= 50) {
        uniformityStatement = `The subject property is assessed above the median comparable. Assessment uniformity analysis shows a coefficient of dispersion of ${coefficientOfDispersion.toFixed(1)}%.`;
      } else {
        uniformityStatement = `The subject property's assessment is within normal ranges compared to similar properties.`;
      }

      uniformityAnalysis = {
        percentileRank,
        comparablePoolSize: allCompsWithSqft.length,
        propertiesAssessedLower,
        coefficientOfDispersion: Math.round(coefficientOfDispersion * 10) / 10,
        neighborhoodMetrics: {
          avgValuePerSqft: Math.round(neighborhoodAvg * 100) / 100,
          subjectVsNeighborhood: Math.round(subjectVsNeighborhood * 10) / 10,
          sampleSize: neighborhoodComps.length,
        },
        uniformityRating,
        uniformityStatement,
      };

      // Add appeal ground if significant disparity
      if (percentileRank >= 75 && !scoringResult.appealGrounds.includes('uniformity_disparity')) {
        scoringResult.appealGrounds.push('uniformity_disparity');
      }

      // Legacy equityAnalysis support
      equityAnalysis = {
        percentileRank,
        totalComparables: allCompsWithSqft.length,
        propertiesAssessedLower,
        neighborhoodAvgPerSqft: Math.round(neighborhoodAvg * 100) / 100,
        vsNeighborhoodAverage: Math.round(subjectVsNeighborhood * 10) / 10,
        equityStatement: uniformityStatement,
      };
    }
  }

  // ============================================================
  // MARKET TIMING ANALYSIS - Is this a good year to appeal?
  // Look at sales volume trends, price trends, DOM trends
  // ============================================================
  let marketTiming: AppealOpportunity['analysis']['marketTiming'];
  if (comparableSales.length >= 3) {
    // Analyze sales data for market indicators
    const salesByDate = comparableSales
      .filter(s => s.saleDate)
      .sort((a, b) => new Date(a.saleDate!).getTime() - new Date(b.saleDate!).getTime());

    // Split into recent (last 6 months) vs older (6-18 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentSales = salesByDate.filter(s => new Date(s.saleDate!) >= sixMonthsAgo);
    const olderSales = salesByDate.filter(s => new Date(s.saleDate!) < sixMonthsAgo);

    // Determine trends (simplified - in production would use more sophisticated analysis)
    let priceTrend: 'declining' | 'stable' | 'rising' | 'unknown' = 'unknown';
    let salesVolumeTrend: 'declining' | 'stable' | 'increasing' | 'unknown' = 'unknown';

    if (recentSales.length >= 2 && olderSales.length >= 2) {
      const recentAvgPrice = recentSales.reduce((sum, s) => sum + s.salePrice, 0) / recentSales.length;
      const olderAvgPrice = olderSales.reduce((sum, s) => sum + s.salePrice, 0) / olderSales.length;

      const priceChange = ((recentAvgPrice - olderAvgPrice) / olderAvgPrice) * 100;

      if (priceChange < -5) {
        priceTrend = 'declining';
      } else if (priceChange > 5) {
        priceTrend = 'rising';
      } else {
        priceTrend = 'stable';
      }

      // Compare sales volume (simple count comparison)
      // Normalize by time period
      const recentMonths = 6;
      const olderMonths = 12;
      const recentVolumePerMonth = recentSales.length / recentMonths;
      const olderVolumePerMonth = olderSales.length / olderMonths;

      const volumeChange = olderVolumePerMonth > 0
        ? ((recentVolumePerMonth - olderVolumePerMonth) / olderVolumePerMonth) * 100
        : 0;

      if (volumeChange < -20) {
        salesVolumeTrend = 'declining';
      } else if (volumeChange > 20) {
        salesVolumeTrend = 'increasing';
      } else {
        salesVolumeTrend = 'stable';
      }
    }

    // Determine if market is favorable for appeals
    // Declining or stable markets favor appeals (assessments often lag reality)
    const favorableMarket = priceTrend === 'declining' || salesVolumeTrend === 'declining';

    // Build summary
    let summary: string;
    if (priceTrend === 'declining' && salesVolumeTrend === 'declining') {
      summary = 'Market conditions are highly favorable for an appeal. Declining prices and sales volume suggest assessments may be lagging the market downturn.';
    } else if (priceTrend === 'declining' || salesVolumeTrend === 'declining') {
      summary = 'Market conditions are moderately favorable for an appeal. Some indicators suggest the market may be softening.';
    } else if (priceTrend === 'rising') {
      summary = 'Market is rising, which may make appeals more challenging. However, if your property is still overassessed relative to comparables, an appeal may still be worthwhile.';
    } else {
      summary = 'Market conditions are neutral. Focus on comparable property evidence for your appeal.';
    }

    marketTiming = {
      favorableMarket,
      indicators: {
        domTrend: 'unknown', // Would need additional data source for DOM
        salesVolumeTrend,
        priceTrend,
      },
      summary,
    };

    // Add market timing ground if favorable
    if (favorableMarket && !scoringResult.appealGrounds.includes('market_timing')) {
      scoringResult.appealGrounds.push('market_timing');
    }
  }

  // ============================================================
  // LAYER 3: ASSESSMENT DRIFT ANALYSIS
  // Identifies historical patterns where assessment growth has exceeded
  // market trends. This is a "correction" argument, not a "minimization" argument.
  // ============================================================
  let driftAnalysis: AppealOpportunity['analysis']['driftAnalysis'];
  let historicalAnalysis: AppealOpportunity['analysis']['historicalAnalysis']; // Legacy support

  // Fetch historical assessment data
  try {
    const historicalValues = await querySODA<AssessedValue>(
      DATASETS.ASSESSED_VALUES,
      {
        '$where': `pin = '${pin}'`,
        '$order': 'year DESC',
        '$limit': '10'
      }
    );

    if (historicalValues.length >= 3) {
      // Sort by year ascending for analysis
      const sortedValues = historicalValues
        .map(v => ({
          year: parseInt(v.year),
          value: parseNumber(v.board_tot) || parseNumber(v.certified_tot) || parseNumber(v.mailed_tot) || 0,
        }))
        .filter(v => v.value > 0)
        .sort((a, b) => a.year - b.year);

      if (sortedValues.length >= 3) {
        const yearsAnalyzed = sortedValues.length;
        const firstValue = sortedValues[0].value;
        const lastValue = sortedValues[sortedValues.length - 1].value;
        const yearSpan = sortedValues[sortedValues.length - 1].year - sortedValues[0].year;

        // Calculate compound annual growth rate of assessments
        const assessmentCAGR = yearSpan > 0
          ? (Math.pow(lastValue / firstValue, 1 / yearSpan) - 1) * 100
          : 0;

        // Estimated market CAGR (based on typical Cook County appreciation)
        // In production, this could be calculated from actual sales data
        const marketCAGR = 3.5; // Conservative estimate

        // Excess growth rate
        const excessGrowthRate = assessmentCAGR - marketCAGR;
        const systematicOverassessment = excessGrowthRate > 2; // >2% above market is significant

        // Calculate cumulative excess
        const cumulativeExcess = systematicOverassessment && yearSpan > 0
          ? Math.round(lastValue * (excessGrowthRate / 100) * yearSpan)
          : 0;

        // Build professional drift statement
        let driftStatement: string;
        if (systematicOverassessment && excessGrowthRate >= 5) {
          driftStatement = `Historical analysis over ${yearsAnalyzed} years reveals systematic assessment drift. Assessments have grown at ${assessmentCAGR.toFixed(1)}% annually, significantly exceeding typical market appreciation of ${marketCAGR}%. This pattern suggests accumulated assessment error requiring correction.`;
        } else if (systematicOverassessment) {
          driftStatement = `Assessment records show growth of ${assessmentCAGR.toFixed(1)}% annually over ${yearsAnalyzed} years, ${excessGrowthRate.toFixed(1)} percentage points above estimated market trends. Historical patterns support reassessment review.`;
        } else if (assessmentCAGR > marketCAGR) {
          driftStatement = `Assessment growth of ${assessmentCAGR.toFixed(1)}% annually is moderately above market trends. No significant correction indicated.`;
        } else {
          driftStatement = `Historical assessment patterns align with market trends.`;
        }

        driftAnalysis = {
          systematicOverassessment,
          yearsAnalyzed,
          assessmentCAGR: Math.round(assessmentCAGR * 10) / 10,
          marketCAGR,
          excessGrowthRate: Math.round(excessGrowthRate * 10) / 10,
          cumulativeExcess,
          assessmentHistory: sortedValues.map(v => ({
            year: v.year,
            assessedValue: v.value,
          })),
          driftStatement,
        };

        // Legacy support
        historicalAnalysis = {
          persistentOverassessment: systematicOverassessment,
          yearsAnalyzed,
          assessmentGrowthRate: Math.round(assessmentCAGR * 10) / 10,
          cumulativeOverassessment: cumulativeExcess,
        };

        // Add appeal ground if systematic drift detected
        if (systematicOverassessment && !scoringResult.appealGrounds.includes('assessment_drift')) {
          scoringResult.appealGrounds.push('assessment_drift');
        }
      }
    }
  } catch (error) {
    // Log but don't fail - drift analysis is optional
    console.warn('Error fetching historical assessment data:', error);
  }

  // ============================================================
  // CONSOLIDATED APPEAL SUMMARY
  // Combines all three layers into a professional appeal recommendation.
  // Uses principled language that sounds like a professional firm.
  // ============================================================
  let appealSummary: AppealOpportunity['analysis']['appealSummary'];

  // Calculate recommended value based on strongest evidence
  const marketFairValue = marketValueAnalysis?.fairAssessedValue;
  const uniformityFairValue = uniformityAnalysis && subjectSqft > 0
    ? Math.round(uniformityAnalysis.neighborhoodMetrics.avgValuePerSqft * subjectSqft)
    : undefined;

  // Use market value as primary, uniformity as secondary check
  const recommendedAssessedValue = marketFairValue || uniformityFairValue || subjectValue;
  const requestedReduction = subjectValue - recommendedAssessedValue;
  const estimatedAnnualSavings = Math.round(requestedReduction * 0.065);

  // Build primary arguments ranked by strength
  const primaryArguments: Array<{type: 'market_value' | 'uniformity' | 'assessment_drift'; strength: number; summary: string}> = [];

  if (marketValueAnalysis && marketValueAnalysis.percentAboveMedian >= 5) {
    const strength = Math.min(100, 50 + marketValueAnalysis.percentAboveMedian * 2);
    primaryArguments.push({
      type: 'market_value',
      strength,
      summary: `Market analysis indicates overassessment of ${marketValueAnalysis.percentAboveMedian.toFixed(1)}% above comparable properties.`,
    });
  }

  if (uniformityAnalysis && uniformityAnalysis.percentileRank >= 60) {
    const strength = Math.min(100, uniformityAnalysis.percentileRank);
    primaryArguments.push({
      type: 'uniformity',
      strength,
      summary: `Uniformity analysis shows assessment exceeds ${uniformityAnalysis.percentileRank}% of comparable properties, indicating potential assessment disparity.`,
    });
  }

  if (driftAnalysis && driftAnalysis.systematicOverassessment) {
    const strength = Math.min(100, 50 + driftAnalysis.excessGrowthRate * 5);
    primaryArguments.push({
      type: 'assessment_drift',
      strength,
      summary: `Historical analysis reveals ${driftAnalysis.yearsAnalyzed}-year pattern of assessment growth exceeding market trends by ${driftAnalysis.excessGrowthRate.toFixed(1)}% annually.`,
    });
  }

  // Sort by strength
  primaryArguments.sort((a, b) => b.strength - a.strength);

  // Determine overall strength
  let overallStrength: 'strong' | 'moderate' | 'weak' = 'weak';
  const maxStrength = primaryArguments.length > 0 ? Math.max(...primaryArguments.map(a => a.strength)) : 0;
  const avgStrength = primaryArguments.length > 0
    ? primaryArguments.reduce((sum, a) => sum + a.strength, 0) / primaryArguments.length
    : 0;

  if (maxStrength >= 75 && avgStrength >= 60 && primaryArguments.length >= 2) {
    overallStrength = 'strong';
  } else if (maxStrength >= 60 || (avgStrength >= 50 && primaryArguments.length >= 2)) {
    overallStrength = 'moderate';
  }

  // Build professional appeal statement
  let appealStatement: string;
  if (overallStrength === 'strong' && requestedReduction > 0) {
    appealStatement = `Based on comprehensive analysis of market data, assessment uniformity, and historical patterns, the current assessment of $${subjectValue.toLocaleString()} exceeds fair and equitable valuation. Analysis of ${marketValueAnalysis?.representativeComparables.length || 0} comparable properties and ${driftAnalysis?.yearsAnalyzed || 0} years of assessment history supports a fair assessed value of $${recommendedAssessedValue.toLocaleString()}, representing a correction of $${requestedReduction.toLocaleString()}.`;
  } else if (overallStrength === 'moderate' && requestedReduction > 0) {
    appealStatement = `Analysis indicates the current assessment may exceed fair market-based valuation. Comparable property data and uniformity analysis suggest a fair assessed value of $${recommendedAssessedValue.toLocaleString()}, compared to the current assessment of $${subjectValue.toLocaleString()}.`;
  } else if (requestedReduction > 0) {
    appealStatement = `Limited evidence suggests the assessment may be above market rates. Further review may be warranted.`;
  } else {
    appealStatement = `Current assessment appears to align with comparable properties and market conditions.`;
  }

  if (primaryArguments.length > 0 || requestedReduction > 0) {
    appealSummary = {
      recommendedAssessedValue,
      requestedReduction,
      estimatedAnnualSavings,
      overallStrength,
      primaryArguments,
      appealStatement,
    };
  }

  return {
    property,
    comparables: comparables.slice(0, 10),
    comparableSales: comparableSales.slice(0, 6), // Top 6 sales for appeal evidence
    analysis: {
      opportunityScore: scoringResult.opportunityScore,
      estimatedOvervaluation: scoringResult.estimatedOvervaluation,
      estimatedTaxSavings: scoringResult.estimatedTaxSavings,
      medianComparableValue: scoringResult.medianComparableValue,
      averageComparableValue: scoringResult.averageComparableValue,
      comparableCount: compValues.length,
      appealGrounds: scoringResult.appealGrounds,
      confidence: scoringResult.confidence,
      perSqftAnalysis,
      salesAnalysis,
      // New three-layer credible architecture
      marketValueAnalysis,
      uniformityAnalysis,
      driftAnalysis,
      appealSummary,
      marketTiming,
      // Legacy fields (deprecated)
      appealCase,
      equityAnalysis,
      historicalAnalysis,
    },
    priorAppeals,
    deadlines: {
      ccaoOpen: null, // Would need to fetch from deadlines table
      ccaoClose: null,
      borOpen: null,
      borClose: null,
      daysUntilDeadline: null,
    },
  };
}

/**
 * Get recent sales in a neighborhood for market analysis
 */
export async function getNeighborhoodSales(
  neighborhood: string,
  propertyClass: string,
  years: number = 2,
  limit: number = 50
): Promise<SaleRecord[]> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
  const dateStr = cutoffDate.toISOString().split('T')[0];

  const sales = await querySODA<SaleRecord>(
    DATASETS.SALES_ARCHIVED,
    {
      '$where': `nbhd = '${neighborhood}'
        AND class = '${propertyClass}'
        AND sale_date >= '${dateStr}'
        AND sale_price > '50000'`,
      '$order': 'sale_date DESC',
      '$limit': String(limit)
    }
  );

  return sales;
}

/**
 * LAYER 4: Neighborhood Conditions Analysis
 * Fetches 311 service request data from Supabase to identify neighborhood
 * factors that may impact property values.
 *
 * This is SECONDARY supporting evidence - only surfaces when conditions
 * are clearly negative and trending worse.
 */
export interface NeighborhoodConditionsData {
  ward: number;
  communityArea: number | null;
  conditionRating: 'stable' | 'some_concerns' | 'significant_concerns';
  indicators: {
    vacantBuildings: { count: number; trend: 'increasing' | 'stable' | 'decreasing'; percentile: number };
    rodentComplaints: { count: number; trend: 'increasing' | 'stable' | 'decreasing'; percentile: number };
    graffitiRequests: { count: number; trend: 'increasing' | 'stable' | 'decreasing'; percentile: number };
    abandonedVehicles: { count: number; trend: 'increasing' | 'stable' | 'decreasing'; percentile: number };
    buildingViolations: { count: number; trend: 'increasing' | 'stable' | 'decreasing'; percentile: number };
  };
  distressScore: number;
  supportsReduction: boolean;
  conditionsStatement: string | null;
}

/**
 * Fetch neighborhood conditions for a given ward from Supabase 311 data.
 * Uses service_request_stats table aggregated by ward.
 */
export async function getNeighborhoodConditions(
  ward: number,
  supabaseClient: any // Accept supabase client to avoid circular dependency
): Promise<NeighborhoodConditionsData | null> {
  try {
    // Fetch 311 stats for this ward
    const { data: wardStats, error } = await supabaseClient
      .from('service_request_stats')
      .select('sr_type, total_requests, requests_last_30_days, requests_last_365_days, community_area')
      .eq('ward', ward);

    if (error || !wardStats || wardStats.length === 0) {
      return null;
    }

    // Get community area from first record
    const communityArea = wardStats[0]?.community_area || null;

    // Fetch city-wide averages for percentile calculation
    const { data: cityStats } = await supabaseClient
      .from('service_request_stats')
      .select('sr_type, total_requests, requests_last_30_days, requests_last_365_days')
      .in('sr_type', [
        'Vacant/Abandoned Building Complaint',
        'Rodent Baiting/Rat Complaint',
        'Graffiti Removal Request',
        'Abandoned Vehicle Complaint',
        'Building Violation'
      ]);

    // Calculate city-wide averages per ward
    const cityAverages: Record<string, { total: number; count: number }> = {};
    if (cityStats) {
      for (const stat of cityStats) {
        if (!cityAverages[stat.sr_type]) {
          cityAverages[stat.sr_type] = { total: 0, count: 0 };
        }
        cityAverages[stat.sr_type].total += stat.requests_last_365_days || 0;
        cityAverages[stat.sr_type].count += 1;
      }
    }

    // Helper to get indicator data
    const getIndicator = (srType: string) => {
      const stat = wardStats.find((s: any) => s.sr_type === srType);
      const count = stat?.requests_last_365_days || 0;
      const recent = stat?.requests_last_30_days || 0;

      // Calculate trend: compare last 30 days annualized vs last 365 days
      const annualizedRecent = recent * 12;
      let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
      if (count > 0) {
        const trendRatio = annualizedRecent / count;
        if (trendRatio > 1.2) trend = 'increasing';
        else if (trendRatio < 0.8) trend = 'decreasing';
      }

      // Calculate percentile vs city average
      const cityAvg = cityAverages[srType]?.count > 0
        ? cityAverages[srType].total / cityAverages[srType].count
        : count;
      const percentile = cityAvg > 0 ? Math.round((count / cityAvg) * 100) : 100;

      return { count, trend, percentile };
    };

    const indicators = {
      vacantBuildings: getIndicator('Vacant/Abandoned Building Complaint'),
      rodentComplaints: getIndicator('Rodent Baiting/Rat Complaint'),
      graffitiRequests: getIndicator('Graffiti Removal Request'),
      abandonedVehicles: getIndicator('Abandoned Vehicle Complaint'),
      buildingViolations: getIndicator('Building Violation'),
    };

    // Calculate composite distress score (0-100)
    // Weight: vacant buildings (30%), rodents (20%), graffiti (15%), abandoned vehicles (20%), violations (15%)
    const distressScore = Math.min(100, Math.round(
      (indicators.vacantBuildings.percentile * 0.30) +
      (indicators.rodentComplaints.percentile * 0.20) +
      (indicators.graffitiRequests.percentile * 0.15) +
      (indicators.abandonedVehicles.percentile * 0.20) +
      (indicators.buildingViolations.percentile * 0.15)
    ));

    // Determine condition rating
    let conditionRating: 'stable' | 'some_concerns' | 'significant_concerns';
    if (distressScore >= 150) {
      conditionRating = 'significant_concerns';
    } else if (distressScore >= 120) {
      conditionRating = 'some_concerns';
    } else {
      conditionRating = 'stable';
    }

    // Count increasing trends
    const increasingTrends = Object.values(indicators).filter(i => i.trend === 'increasing').length;

    // Only support reduction if: high distress AND multiple increasing trends
    const supportsReduction = distressScore >= 130 && increasingTrends >= 2;

    // Build professional statement (only if supports reduction)
    let conditionsStatement: string | null = null;
    if (supportsReduction) {
      const concerns: string[] = [];
      if (indicators.vacantBuildings.percentile >= 150 || indicators.vacantBuildings.trend === 'increasing') {
        concerns.push('elevated vacant building complaints');
      }
      if (indicators.rodentComplaints.percentile >= 150 || indicators.rodentComplaints.trend === 'increasing') {
        concerns.push('above-average rodent complaints');
      }
      if (indicators.graffitiRequests.percentile >= 150 || indicators.graffitiRequests.trend === 'increasing') {
        concerns.push('elevated graffiti removal requests');
      }
      if (indicators.abandonedVehicles.percentile >= 150 || indicators.abandonedVehicles.trend === 'increasing') {
        concerns.push('above-average abandoned vehicle complaints');
      }
      if (indicators.buildingViolations.percentile >= 150 || indicators.buildingViolations.trend === 'increasing') {
        concerns.push('elevated building code violations');
      }

      if (concerns.length > 0) {
        const concernsText = concerns.length === 1
          ? concerns[0]
          : concerns.slice(0, -1).join(', ') + ' and ' + concerns[concerns.length - 1];

        conditionsStatement = `Neighborhood condition analysis for Ward ${ward} indicates ${concernsText}. ` +
          `City service request data shows ${increasingTrends} of 5 key quality-of-life indicators trending upward, ` +
          `suggesting environmental factors that may negatively impact property values in this area. ` +
          `These conditions should be considered when evaluating fair market value.`;
      }
    }

    return {
      ward,
      communityArea,
      conditionRating,
      indicators,
      distressScore,
      supportsReduction,
      conditionsStatement,
    };
  } catch (error) {
    console.warn('Error fetching neighborhood conditions:', error);
    return null;
  }
}

/**
 * Calculate opportunity score and analysis from property data.
 * This is a pure function for testability.
 */
export interface OpportunityInput {
  subjectValue: number;
  comparableValues: number[];
  hasRecentAppealSuccess: boolean;
  /** Year-over-year assessment change percentage (e.g., 51.5 for 51.5% increase) */
  assessmentChangePercent?: number | null;
  /** Subject property square footage */
  subjectSquareFootage?: number | null;
  /** Comparable square footages (same order as comparableValues) */
  comparableSquareFootages?: (number | null)[];
  /** Multi-year assessment values [oldest...newest] for trend analysis */
  historicalAssessments?: number[];
  /** Neighborhood median change percentage (declining areas are good for appeals) */
  neighborhoodChangePercent?: number | null;
  /** Subject property characteristics for error detection */
  subjectCharacteristics?: {
    bedrooms?: number | null;
    bathrooms?: number | null;
    yearBuilt?: number | null;
    stories?: number | null;
  };
  /** Comparable characteristics for error detection */
  comparableCharacteristics?: Array<{
    bedrooms?: number | null;
    bathrooms?: number | null;
    yearBuilt?: number | null;
    stories?: number | null;
  }>;
  /** Is this a success fee customer (lower risk = lower thresholds) */
  isSuccessFeeCustomer?: boolean;
}

export interface OpportunityOutput {
  opportunityScore: number;
  estimatedOvervaluation: number;
  estimatedTaxSavings: number;
  medianComparableValue: number;
  averageComparableValue: number;
  appealGrounds: string[];
  confidence: 'high' | 'medium' | 'low';
  /** Breakdown of score components for transparency */
  scoreBreakdown?: {
    overvaluationPoints: number;
    sampleSizePoints: number;
    consistencyPoints: number;
    assessmentIncreasePoints: number;
    historicalSuccessPoints: number;
    neighborhoodTrendPoints: number;
    persistentOverassessmentPoints: number;
    characteristicAnomalyPoints: number;
    perSqftPoints: number;
  };
  /** Suggested action even for low-scoring properties */
  alternativeAction?: 'watchlist' | 'recheck_next_year' | 'verify_characteristics' | null;
  /** Reason for alternative action */
  alternativeActionReason?: string;
}

/**
 * Get comparable sales from the Parcel Sales dataset
 * Returns recent arm's-length sales in the same township and property class
 * with similar bedroom count and square footage.
 *
 * This provides ACTUAL SALES DATA - the strongest evidence for property tax appeals.
 * "These sold for $X. My assessment implies $Y. That's not market-accurate."
 */
export async function getComparableSales(
  subjectProperty: NormalizedProperty,
  limit: number = 10
): Promise<ComparableSale[]> {
  const currentYear = new Date().getFullYear();
  const sqft = subjectProperty.squareFootage || 800;
  const subjectBedrooms = subjectProperty.bedrooms;
  const yearBuilt = subjectProperty.yearBuilt || 1980;

  // Sales within last 18 months are most relevant for appeals
  // Per user feedback: "Sold close to Jan 1 of the tax year"
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 18);
  const dateStr = cutoffDate.toISOString().split('T')[0];

  console.log(`Searching for comparable sales: township=${subjectProperty.townshipCode}, class=${subjectProperty.propertyClass}, bedrooms=${subjectBedrooms}, sqft=${sqft}`);

  // Check if this is a condo
  const isCondo = subjectProperty.propertyClass === '299' ||
                  subjectProperty.propertyClass === '399' ||
                  subjectProperty.propertyClassDescription?.toLowerCase().includes('condo');

  try {
    // Query Parcel Sales dataset for arm's-length transactions
    // Filters out:
    // - Multi-parcel sales (is_multisale = false)
    // - Sales under $10k (sale_filter_less_than_10k = false)
    // - Non-arm's-length deed types (sale_filter_deed_type = false)
    // - Same-property resales within 365 days (sale_filter_same_sale_within_365 = false)
    const sales = await querySODA<ParcelSale>(
      DATASETS.PARCEL_SALES,
      {
        '$where': `township_code = '${subjectProperty.townshipCode}'
          AND class = '${subjectProperty.propertyClass}'
          AND pin != '${subjectProperty.pin}'
          AND sale_date >= '${dateStr}'
          AND sale_price > '25000'
          AND is_multisale = false
          AND sale_filter_less_than_10k = false
          AND sale_filter_deed_type = false`,
        '$order': 'sale_date DESC',
        '$limit': '200'
      }
    );

    console.log(`Found ${sales.length} potential comparable sales`);

    if (sales.length === 0) {
      return [];
    }

    // Get PINs for enrichment with characteristics
    const salePins = sales.map(s => s.pin);
    const pinList = salePins.slice(0, 100).map(p => `'${p}'`).join(',');

    // For condos, get characteristics from condo dataset to filter by bedroom/sqft
    let condoChars: Map<string, CondoCharacteristics> = new Map();
    if (isCondo) {
      const condos = await querySODA<CondoCharacteristics>(
        DATASETS.CONDO_CHARACTERISTICS,
        {
          '$where': `pin in (${pinList})`,
          '$order': 'year DESC',
          '$limit': '200'
        }
      );

      // Group by PIN, keep most recent
      for (const condo of condos) {
        if (!condoChars.has(condo.pin)) {
          condoChars.set(condo.pin, condo);
        }
      }
      console.log(`Enriched ${condoChars.size} sales with condo characteristics`);
    }

    // For non-condos, get characteristics from residential dataset
    let resChars: Map<string, PropertyCharacteristics> = new Map();
    if (!isCondo) {
      const chars = await querySODA<PropertyCharacteristics>(
        DATASETS.CHARACTERISTICS,
        {
          '$where': `pin in (${pinList})`,
          '$order': 'tax_year DESC',
          '$limit': '200'
        }
      );

      for (const char of chars) {
        if (!resChars.has(char.pin)) {
          resChars.set(char.pin, char);
        }
      }
      console.log(`Enriched ${resChars.size} sales with residential characteristics`);
    }

    // Build comparable sales with enriched data
    const comparableSales: (ComparableSale & { similarityScore: number })[] = [];

    for (const sale of sales) {
      const salePrice = parseNumber(sale.sale_price);
      if (!salePrice || salePrice < 25000) continue;

      let saleBedrooms: number | null = null;
      let saleSqft: number | null = null;
      let saleYearBuilt: number | null = null;
      let saleAddress = '';

      if (isCondo) {
        const condo = condoChars.get(sale.pin);
        if (condo) {
          saleBedrooms = parseInt(condo.char_bedrooms);
          saleYearBuilt = parseInt(condo.char_yrblt);

          // Calculate unit sqft from proration rate if unit_sf not available
          saleSqft = parseInt(condo.char_unit_sf);
          if (!saleSqft || saleSqft <= 0) {
            const buildingSf = parseNumber(condo.char_building_sf);
            const prorationRate = parseNumber(condo.tieback_proration_rate);
            if (buildingSf && prorationRate && prorationRate > 0 && prorationRate < 1) {
              saleSqft = Math.round(buildingSf * prorationRate);
            }
          }

          // If bedroom data is missing but subject has bedroom info,
          // try to estimate based on proration rate (unit size)
          // Typical 1BR: 600-800 sqft, 2BR: 900-1200 sqft, Studio: 400-550 sqft
          if ((saleBedrooms === null || isNaN(saleBedrooms)) && saleSqft && subjectBedrooms !== null) {
            // Estimate bedrooms from sqft
            if (saleSqft < 600) {
              saleBedrooms = 0; // Studio
            } else if (saleSqft < 900) {
              saleBedrooms = 1;
            } else if (saleSqft < 1200) {
              saleBedrooms = 2;
            } else {
              saleBedrooms = 3;
            }
          }

          // Create address from unit number
          const unitSuffix = sale.pin.slice(-4);
          const unitNumber = unitSuffix.startsWith('1') ? unitSuffix.slice(1).replace(/^0+/, '') : unitSuffix.replace(/^0+/, '');
          saleAddress = `Unit ${unitNumber || 'N/A'}`;
        } else {
          // For condos without enrichment data in characteristics dataset,
          // skip entirely - we can't verify it's a comparable unit
          continue;
        }
      } else {
        const char = resChars.get(sale.pin);
        if (char) {
          saleBedrooms = parseInt(char.beds);
          saleSqft = parseInt(char.bldg_sf);
          const age = parseInt(char.age);
          saleYearBuilt = age ? currentYear - age : null;
          saleAddress = char.addr || '';
        }
      }

      // FILTER: Same bedroom count (critical for valid comparisons)
      // Per user feedback: 1BR vs 2BR are NOT valid comparables
      if (subjectBedrooms !== null && subjectBedrooms !== undefined &&
          saleBedrooms !== null && saleBedrooms !== subjectBedrooms) {
        if (Math.abs(saleBedrooms - subjectBedrooms) > 1) {
          continue; // Skip - too different
        }
      }

      // FILTER: Similar size (±30% per user feedback: "Similar size ±20%")
      // Being slightly more lenient at 30% to get more comps
      if (saleSqft && sqft && Math.abs(saleSqft - sqft) / sqft > 0.30) {
        continue; // Skip - size too different
      }

      // Calculate price per sqft
      const pricePerSqft = saleSqft && saleSqft > 0 ? salePrice / saleSqft : null;

      // Calculate differences for comparison
      const sqftDiff = saleSqft && sqft ? ((saleSqft - sqft) / sqft) * 100 : null;
      const ageDiff = saleYearBuilt && yearBuilt ? saleYearBuilt - yearBuilt : null;

      // Price implied by sale vs subject's assessed value
      const priceDiff = subjectProperty.assessedValue
        ? salePrice - (subjectProperty.assessedValue * 10) // Market value = assessed * 10 in Cook County
        : null;

      // Calculate similarity score
      let similarityScore = 100;

      // Same bedrooms: +20 points
      if (saleBedrooms === subjectBedrooms) {
        similarityScore += 20;
      } else if (saleBedrooms !== null && subjectBedrooms !== null) {
        similarityScore -= 30 * Math.abs(saleBedrooms - subjectBedrooms);
      }

      // Same neighborhood: +15 points
      if (sale.nbhd === subjectProperty.neighborhood) {
        similarityScore += 15;
      }

      // Square footage similarity
      if (sqftDiff !== null) {
        if (Math.abs(sqftDiff) <= 10) {
          similarityScore += 15; // Within 10%
        } else if (Math.abs(sqftDiff) <= 20) {
          similarityScore += 5; // Within 20%
        } else {
          similarityScore -= Math.abs(sqftDiff) * 0.3;
        }
      }

      // Year built similarity
      if (ageDiff !== null) {
        similarityScore -= Math.min(10, Math.abs(ageDiff) * 0.3);
      }

      // Recency bonus (sales closer to Jan 1 of tax year are more relevant)
      const saleDate = new Date(sale.sale_date);
      const monthsAgo = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (monthsAgo <= 6) {
        similarityScore += 10; // Very recent
      } else if (monthsAgo <= 12) {
        similarityScore += 5; // Within a year
      }

      comparableSales.push({
        pin: sale.pin,
        pinFormatted: formatPin(sale.pin),
        address: saleAddress,
        saleDate: sale.sale_date,
        salePrice,
        pricePerSqft,
        squareFootage: saleSqft,
        bedrooms: saleBedrooms,
        yearBuilt: saleYearBuilt,
        township: subjectProperty.township,
        neighborhood: sale.nbhd || '',
        propertyClass: sale.class,
        sqftDifferencePct: sqftDiff,
        ageDifferenceYears: ageDiff,
        priceDifferenceFromAssessed: priceDiff,
        similarityScore,
      });
    }

    // Sort by similarity score (highest first)
    comparableSales.sort((a, b) => b.similarityScore - a.similarityScore);

    // Return top sales without similarity score field
    return comparableSales.slice(0, limit).map(({ similarityScore, ...sale }) => sale);

  } catch (error) {
    console.error('Error fetching comparable sales:', error);
    return [];
  }
}

export function calculateOpportunityScore(input: OpportunityInput): OpportunityOutput {
  const {
    subjectValue,
    comparableValues,
    hasRecentAppealSuccess,
    assessmentChangePercent,
    subjectSquareFootage,
    comparableSquareFootages,
    historicalAssessments,
    neighborhoodChangePercent,
    subjectCharacteristics,
    comparableCharacteristics,
    isSuccessFeeCustomer
  } = input;

  // For success fee customers, we use lower thresholds since they have no financial risk
  const thresholdMultiplier = isSuccessFeeCustomer ? 0.7 : 1.0;

  // Calculate median and average
  const sortedValues = [...comparableValues].sort((a, b) => a - b);
  const medianValue = sortedValues.length > 0
    ? sortedValues[Math.floor(sortedValues.length / 2)]
    : 0;
  const avgValue = sortedValues.length > 0
    ? sortedValues.reduce((a, b) => a + b, 0) / sortedValues.length
    : 0;

  // Calculate overvaluation
  let estimatedOvervaluation = 0;
  if (medianValue && subjectValue > medianValue) {
    estimatedOvervaluation = subjectValue - medianValue;
  }

  // Estimate tax savings (Cook County effective rate ~2.1%)
  const taxRate = 0.021;
  const estimatedTaxSavings = estimatedOvervaluation * taxRate;

  // ============================================================================
  // ENHANCED SCORING ALGORITHM (0-100 points, expanded from original)
  // ============================================================================
  // Base factors (original):
  // - Overvaluation vs comparables: up to 30 points
  // - Sample size: up to 10 points
  // - Comparable consistency: up to 10 points
  // - Assessment increase: up to 20 points
  // - Historical appeal success: up to 5 points
  //
  // NEW factors to expand appealable pool:
  // - Per-sqft overvaluation: up to 10 points (catches size-adjusted issues)
  // - Neighborhood decline: up to 5 points (declining areas = appeal ground)
  // - Persistent overassessment: up to 5 points (multi-year trend)
  // - Characteristic anomaly: up to 5 points (data errors boost case)
  // ============================================================================

  let overvaluationPoints = 0;
  let sampleSizePoints = 0;
  let consistencyPoints = 0;
  let assessmentIncreasePoints = 0;
  let historicalSuccessPoints = 0;
  let neighborhoodTrendPoints = 0;
  let persistentOverassessmentPoints = 0;
  let characteristicAnomalyPoints = 0;
  let perSqftPoints = 0;

  const appealGrounds: string[] = [];
  let alternativeAction: OpportunityOutput['alternativeAction'] = null;
  let alternativeActionReason: string | undefined;

  // Factor 1: Overvaluation percentage (up to 30 points)
  const overvaluationPct = medianValue ? ((subjectValue - medianValue) / medianValue) * 100 : 0;
  const overvaluationThreshold = 10 * thresholdMultiplier;
  overvaluationPoints = Math.min(30, Math.max(0, overvaluationPct * 1.5));

  if (overvaluationPct > overvaluationThreshold) {
    appealGrounds.push('comparable_sales');
  }

  // Factor 2: Sample size (up to 10 points)
  sampleSizePoints = Math.min(10, sortedValues.length * 1.0);

  // Factor 3: Consistency of comparables (up to 10 points)
  if (sortedValues.length >= 3) {
    const valueSpread = Math.max(...sortedValues) - Math.min(...sortedValues);
    const consistency = 1 - (valueSpread / (avgValue || 1));
    consistencyPoints = Math.max(0, Math.min(10, consistency * 10));
  }

  // Factor 4: Year-over-year assessment increase (up to 20 points)
  const yoyChange = assessmentChangePercent || 0;
  const yoyThreshold = 10 * thresholdMultiplier;
  if (yoyChange > yoyThreshold) {
    assessmentIncreasePoints = Math.min(20, Math.max(0, (yoyChange - yoyThreshold) * 0.5));
  }
  if (yoyChange > 20 * thresholdMultiplier) {
    appealGrounds.push('excessive_increase');
  }
  if (yoyChange > 40 * thresholdMultiplier) {
    appealGrounds.push('dramatic_increase');
  }

  // Factor 5: Historical appeal success (up to 5 points)
  if (hasRecentAppealSuccess) {
    historicalSuccessPoints = 5;
    appealGrounds.push('prior_success');
  }

  // ============================================================================
  // NEW FACTOR 6: Per-sqft overvaluation (up to 10 points)
  // This catches cases where total value looks similar but $/sqft is way off
  // ============================================================================
  if (subjectSquareFootage && subjectSquareFootage > 0 && comparableSquareFootages) {
    const subjectPerSqft = subjectValue / subjectSquareFootage;

    // Calculate $/sqft for comparables
    const compPerSqftValues: number[] = [];
    for (let i = 0; i < comparableValues.length; i++) {
      const sqft = comparableSquareFootages[i];
      if (sqft && sqft > 0) {
        compPerSqftValues.push(comparableValues[i] / sqft);
      }
    }

    if (compPerSqftValues.length >= 3) {
      compPerSqftValues.sort((a, b) => a - b);
      const medianPerSqft = compPerSqftValues[Math.floor(compPerSqftValues.length / 2)];
      const perSqftOvervaluationPct = ((subjectPerSqft - medianPerSqft) / medianPerSqft) * 100;

      if (perSqftOvervaluationPct > 10 * thresholdMultiplier) {
        perSqftPoints = Math.min(10, Math.max(0, perSqftOvervaluationPct * 0.5));
        appealGrounds.push('value_per_sqft');
      }
    }
  }

  // ============================================================================
  // NEW FACTOR 7: Neighborhood decline (up to 5 points)
  // If the neighborhood's median assessment DECREASED but subject increased, that's a ground
  // ============================================================================
  if (neighborhoodChangePercent !== null && neighborhoodChangePercent !== undefined) {
    if (neighborhoodChangePercent < 0 && yoyChange > 0) {
      // Neighborhood declined but subject increased - strong appeal ground
      neighborhoodTrendPoints = Math.min(5, Math.abs(neighborhoodChangePercent - yoyChange) * 0.1);
      appealGrounds.push('neighborhood_decline');
    } else if (neighborhoodChangePercent < yoyChange - 10) {
      // Subject increased much more than neighborhood average
      neighborhoodTrendPoints = Math.min(3, (yoyChange - neighborhoodChangePercent) * 0.1);
      appealGrounds.push('above_neighborhood_trend');
    }
  }

  // ============================================================================
  // NEW FACTOR 8: Persistent overassessment (up to 5 points)
  // If the property has been consistently above comparables for 3+ years
  // ============================================================================
  if (historicalAssessments && historicalAssessments.length >= 3) {
    // Check if consistently increasing faster than inflation (~3%)
    let consecutiveAboveAvg = 0;
    for (let i = 1; i < historicalAssessments.length; i++) {
      const yearOverYearChange = ((historicalAssessments[i] - historicalAssessments[i - 1]) / historicalAssessments[i - 1]) * 100;
      if (yearOverYearChange > 5) {
        consecutiveAboveAvg++;
      }
    }
    if (consecutiveAboveAvg >= 2) {
      persistentOverassessmentPoints = Math.min(5, consecutiveAboveAvg * 2);
      appealGrounds.push('persistent_overassessment');
    }
  }

  // ============================================================================
  // NEW FACTOR 9: Characteristic anomaly detection (up to 5 points)
  // If subject has fewer bedrooms/baths but higher value, might be data error
  // ============================================================================
  if (subjectCharacteristics && comparableCharacteristics && comparableCharacteristics.length >= 3) {
    let anomalyScore = 0;

    // Check bedrooms
    if (subjectCharacteristics.bedrooms !== null && subjectCharacteristics.bedrooms !== undefined) {
      const compBedrooms = comparableCharacteristics
        .map(c => c.bedrooms)
        .filter((b): b is number => b !== null && b !== undefined);
      if (compBedrooms.length >= 3) {
        const avgCompBedrooms = compBedrooms.reduce((a, b) => a + b, 0) / compBedrooms.length;
        // Subject has FEWER bedrooms but HIGHER value? Possible error or overassessment
        if (subjectCharacteristics.bedrooms < avgCompBedrooms && subjectValue > avgValue) {
          anomalyScore += 2;
          appealGrounds.push('fewer_bedrooms_higher_value');
        }
      }
    }

    // Check square footage mismatch (may indicate data error)
    if (subjectSquareFootage && comparableSquareFootages) {
      const validSqfts = comparableSquareFootages.filter((s): s is number => s !== null && s > 0);
      if (validSqfts.length >= 3) {
        const avgSqft = validSqfts.reduce((a, b) => a + b, 0) / validSqfts.length;
        // Subject is SMALLER but assessed HIGHER? Red flag
        if (subjectSquareFootage < avgSqft * 0.9 && subjectValue > avgValue * 1.1) {
          anomalyScore += 3;
          if (!appealGrounds.includes('characteristic_mismatch')) {
            appealGrounds.push('characteristic_mismatch');
          }
          alternativeAction = 'verify_characteristics';
          alternativeActionReason = 'Your property appears smaller than comparables but assessed higher. Verify your recorded square footage is correct.';
        }
      }
    }

    characteristicAnomalyPoints = Math.min(5, anomalyScore);
  }

  // ============================================================================
  // Calculate final score
  // ============================================================================
  let opportunityScore =
    overvaluationPoints +
    sampleSizePoints +
    consistencyPoints +
    assessmentIncreasePoints +
    historicalSuccessPoints +
    neighborhoodTrendPoints +
    persistentOverassessmentPoints +
    characteristicAnomalyPoints +
    perSqftPoints;

  // Clamp score to 0-100
  opportunityScore = Math.round(Math.min(100, Math.max(0, opportunityScore)));

  // ============================================================================
  // Determine confidence
  // ============================================================================
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const effectiveOvervaluationThreshold = 15 * thresholdMultiplier;
  const effectiveYoyThreshold = 30 * thresholdMultiplier;

  if (sortedValues.length >= 5 && (overvaluationPct > effectiveOvervaluationThreshold || yoyChange > effectiveYoyThreshold)) {
    confidence = 'high';
  } else if (sortedValues.length >= 3 && (overvaluationPct > 10 * thresholdMultiplier || yoyChange > 20 * thresholdMultiplier)) {
    confidence = 'medium';
  } else if (yoyChange > 40 * thresholdMultiplier) {
    confidence = 'medium';
  } else if (appealGrounds.length >= 2) {
    // Multiple grounds even if individually weak = medium confidence
    confidence = 'medium';
  }

  // ============================================================================
  // Alternative actions for borderline/low-scoring cases
  // ============================================================================
  if (opportunityScore < 30 && opportunityScore >= 15 && !alternativeAction) {
    alternativeAction = 'watchlist';
    alternativeActionReason = 'Your property is close to the appeal threshold. We can notify you if comparables or deadlines change.';
  } else if (opportunityScore < 30 && yoyChange > 5) {
    alternativeAction = 'recheck_next_year';
    alternativeActionReason = 'Your assessment increased this year. If this trend continues, you may have a stronger case next year.';
  }

  return {
    opportunityScore,
    estimatedOvervaluation,
    estimatedTaxSavings,
    medianComparableValue: medianValue,
    averageComparableValue: avgValue,
    appealGrounds,
    confidence,
    scoreBreakdown: {
      overvaluationPoints: Math.round(overvaluationPoints),
      sampleSizePoints: Math.round(sampleSizePoints),
      consistencyPoints: Math.round(consistencyPoints),
      assessmentIncreasePoints: Math.round(assessmentIncreasePoints),
      historicalSuccessPoints: Math.round(historicalSuccessPoints),
      neighborhoodTrendPoints: Math.round(neighborhoodTrendPoints),
      persistentOverassessmentPoints: Math.round(persistentOverassessmentPoints),
      characteristicAnomalyPoints: Math.round(characteristicAnomalyPoints),
      perSqftPoints: Math.round(perSqftPoints),
    },
    alternativeAction,
    alternativeActionReason
  };
}
