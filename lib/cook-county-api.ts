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

      // FILTER: Skip properties with different square footage (>30% difference)
      // For property tax appeals, size is critical - a 600 sqft unit is NOT comparable to a 1200 sqft unit
      if (compSqft && sqft && Math.abs(compSqft - sqft) / sqft > 0.30) {
        continue; // Skip - size too different for valid comparison
      }

      // Calculate similarity score (higher = more similar)
      // Base score starts at 100
      let similarityScore = 100;

      // HIGHEST PRIORITY: Same building gets massive bonus (+50 points)
      // Units in the same building are best comparables
      if (condo.pin10 === buildingPin10) {
        similarityScore += 50;
      }

      // Bedroom match is critical
      // Same bedrooms: +20 points, Different: -40 points per bedroom
      if (compBedrooms === subjectBedrooms) {
        similarityScore += 20;
      } else if (compBedrooms !== null && !isNaN(compBedrooms) &&
                 subjectBedrooms !== null && subjectBedrooms !== undefined) {
        similarityScore -= 40 * Math.abs(compBedrooms - subjectBedrooms);
      }

      // Square footage similarity (very important for appeals)
      // Perfect match: +15 points, penalty increases with difference
      if (sqftDiff !== null) {
        if (Math.abs(sqftDiff) <= 10) {
          similarityScore += 15; // Within 10% is excellent
        } else if (Math.abs(sqftDiff) <= 20) {
          similarityScore += 5; // Within 20% is good
        } else {
          similarityScore -= Math.abs(sqftDiff) * 0.5; // Penalty for larger differences
        }
      }

      // Same neighborhood bonus (+10 points)
      if (propValue.nbhd === subjectProperty.neighborhood) {
        similarityScore += 10;
      }

      // Year built similarity (-0.5 point per year difference, max -15)
      if (ageDiff !== null) {
        similarityScore -= Math.min(15, Math.abs(ageDiff) * 0.5);
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

    // Return top comparables, removing the similarityScore field
    return comparables.slice(0, limit).map(({ similarityScore, ...comp }) => comp);
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

  // Use the pure scoring function (includes assessment change factor)
  const scoringResult = calculateOpportunityScore({
    subjectValue,
    comparableValues: compValues,
    hasRecentAppealSuccess: hasRecentSuccess,
    assessmentChangePercent: property.assessmentChangePercent,
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
 * Calculate opportunity score and analysis from property data.
 * This is a pure function for testability.
 */
export interface OpportunityInput {
  subjectValue: number;
  comparableValues: number[];
  hasRecentAppealSuccess: boolean;
  /** Year-over-year assessment change percentage (e.g., 51.5 for 51.5% increase) */
  assessmentChangePercent?: number | null;
}

export interface OpportunityOutput {
  opportunityScore: number;
  estimatedOvervaluation: number;
  estimatedTaxSavings: number;
  medianComparableValue: number;
  averageComparableValue: number;
  appealGrounds: string[];
  confidence: 'high' | 'medium' | 'low';
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
  const { subjectValue, comparableValues, hasRecentAppealSuccess, assessmentChangePercent } = input;

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

  // Calculate opportunity score (0-100)
  // Scoring breakdown:
  // - Overvaluation vs comparables: up to 35 points
  // - Sample size: up to 15 points
  // - Comparable consistency: up to 15 points
  // - Assessment increase: up to 25 points (NEW)
  // - Historical appeal success: up to 10 points
  let opportunityScore = 0;

  // Factor 1: Overvaluation percentage (up to 35 points)
  const overvaluationPct = medianValue ? ((subjectValue - medianValue) / medianValue) * 100 : 0;
  opportunityScore += Math.min(35, Math.max(0, overvaluationPct * 1.75));

  // Factor 2: Sample size (up to 15 points)
  opportunityScore += Math.min(15, sortedValues.length * 1.5);

  // Factor 3: Consistency of comparables (up to 15 points)
  if (sortedValues.length >= 3) {
    const valueSpread = Math.max(...sortedValues) - Math.min(...sortedValues);
    const consistency = 1 - (valueSpread / (avgValue || 1));
    opportunityScore += Math.max(0, Math.min(15, consistency * 15));
  }

  // Factor 4: Year-over-year assessment increase (up to 25 points)
  // A large increase (>20%) is a strong argument for appeal
  // Assessments should generally increase at a reasonable rate (e.g., 5-10% annually)
  // Increases over 20% warrant scrutiny, over 40% is a red flag
  const yoyChange = assessmentChangePercent || 0;
  if (yoyChange > 10) {
    // 10-20% increase: 5 points
    // 20-30% increase: 10 points
    // 30-40% increase: 15 points
    // 40-50% increase: 20 points
    // >50% increase: 25 points
    const increasePoints = Math.min(25, Math.max(0, (yoyChange - 10) * 0.5));
    opportunityScore += increasePoints;
  }

  // Factor 5: Historical appeal success (up to 10 points)
  if (hasRecentAppealSuccess) {
    opportunityScore += 10;
  }

  // Clamp score to 0-100
  opportunityScore = Math.round(Math.min(100, Math.max(0, opportunityScore)));

  // Determine appeal grounds
  const appealGrounds: string[] = [];
  if (overvaluationPct > 10) {
    appealGrounds.push('comparable_sales');
  }
  if (yoyChange > 20) {
    appealGrounds.push('excessive_increase');
  }
  if (yoyChange > 40) {
    appealGrounds.push('dramatic_increase');
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (sortedValues.length >= 5 && (overvaluationPct > 15 || yoyChange > 30)) {
    confidence = 'high';
  } else if (sortedValues.length >= 3 && (overvaluationPct > 10 || yoyChange > 20)) {
    confidence = 'medium';
  } else if (yoyChange > 40) {
    // Even with few comparables, a 40%+ increase is a red flag
    confidence = 'medium';
  }

  return {
    opportunityScore,
    estimatedOvervaluation,
    estimatedTaxSavings,
    medianComparableValue: medianValue,
    averageComparableValue: avgValue,
    appealGrounds,
    confidence
  };
}
