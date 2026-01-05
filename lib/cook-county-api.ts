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
  // Property characteristics (residential)
  CHARACTERISTICS: 'bcnq-qi2z',
  // Assessed values history
  ASSESSED_VALUES: 'uzyt-m557',
  // Residential sales
  SALES: '5pge-nu6u',
  // Board of Review decisions
  BOR_DECISIONS: '7pny-nedm',
  // Condo characteristics
  CONDO_CHARACTERISTICS: 'sv5f-d7bh',
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
  mailed_tot: string;  // Mailed total assessed value
  certified_tot: string;  // Certified total assessed value
  board_tot: string;  // Board of Review total assessed value
  mailed_bldg: string;
  mailed_land: string;
  certified_bldg: string;
  certified_land: string;
  board_bldg: string;
  board_land: string;
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
  analysis: {
    opportunityScore: number;  // 0-100
    estimatedOvervaluation: number;
    estimatedTaxSavings: number;
    medianComparableValue: number;
    averageComparableValue: number;
    comparableCount: number;
    appealGrounds: string[];
    confidence: 'high' | 'medium' | 'low';
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
 * Query the Socrata API
 */
async function querySODA<T>(
  dataset: string,
  params: Record<string, string>,
  timeout: number = DEFAULT_TIMEOUTS.default
): Promise<T[]> {
  const queryParams = new URLSearchParams();

  // Add all params
  for (const [key, value] of Object.entries(params)) {
    queryParams.set(key, value);
  }

  const url = `${SOCRATA_BASE_URL}/${dataset}.json?${queryParams.toString()}`;

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
    console.error(`Error querying SODA dataset ${dataset}:`, error);
    throw error;
  }
}

// Main API Functions

/**
 * Look up a property by PIN
 */
export async function getPropertyByPin(pin: string): Promise<NormalizedProperty | null> {
  const normalizedPin = normalizePin(pin);
  const currentYear = new Date().getFullYear();

  // Get property characteristics
  const characteristics = await querySODA<PropertyCharacteristics>(
    DATASETS.CHARACTERISTICS,
    {
      '$where': `pin = '${normalizedPin}'`,
      '$order': 'tax_year DESC',
      '$limit': '1'
    }
  );

  if (characteristics.length === 0) {
    // Try condo dataset
    const condoChars = await querySODA<PropertyCharacteristics>(
      DATASETS.CONDO_CHARACTERISTICS,
      {
        '$where': `pin = '${normalizedPin}'`,
        '$order': 'tax_year DESC',
        '$limit': '1'
      }
    );

    if (condoChars.length === 0) {
      return null;
    }

    // Use condo data
    characteristics.push(condoChars[0]);
  }

  const prop = characteristics[0];

  // Get assessed values for current and prior year
  const values = await querySODA<AssessedValue>(
    DATASETS.ASSESSED_VALUES,
    {
      '$where': `pin = '${normalizedPin}'`,
      '$order': 'year DESC',
      '$limit': '2'
    }
  );

  const currentValue = values.find(v => parseInt(v.year) === currentYear - 1);
  const priorValue = values.find(v => parseInt(v.year) === currentYear - 2);

  // Calculate year built from age (approximate)
  const age = parseInt(prop.age);
  const yearBuilt = age ? currentYear - age : null;

  // Combine the data
  const totalBaths = (parseNumber(prop.fbath) || 0) + ((parseNumber(prop.hbath) || 0) * 0.5);

  // Get township name from assessed values (more reliable)
  const township = currentValue?.township_name || values[0]?.township_name || '';

  return {
    pin: normalizedPin,
    pinFormatted: formatPin(normalizedPin),
    address: prop.addr || '',
    city: 'CHICAGO', // Default - would need address lookup for accurate city
    zipCode: '', // Not in main dataset
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
    // Assessed value is the board_tot (final after Board of Review)
    assessedValue: parseNumber(currentValue?.board_tot) || parseNumber(values[0]?.board_tot),
    // Market value is assessed * 10 (Cook County uses 10% ratio for residential)
    marketValue: (parseNumber(currentValue?.board_tot) || parseNumber(values[0]?.board_tot) || 0) * 10,
    priorAssessedValue: parseNumber(priorValue?.board_tot),
    priorMarketValue: (parseNumber(priorValue?.board_tot) || 0) * 10,
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
      '$where': `pin in (${pinList}) AND stage_name = 'board'`,
      '$order': 'tax_year DESC'
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
      assessedValue: parseNumber(currentValue?.board_tot),
      marketValue: (parseNumber(currentValue?.board_tot) || 0) * 10,
      priorAssessedValue: parseNumber(priorValue?.board_tot),
      priorMarketValue: (parseNumber(priorValue?.board_tot) || 0) * 10,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Get comparable properties for a subject property
 */
export async function getComparableProperties(
  subjectProperty: NormalizedProperty,
  limit: number = 10
): Promise<ComparableProperty[]> {
  // Find properties in same neighborhood with similar characteristics
  const sqft = subjectProperty.squareFootage || 1500;
  const minSqft = Math.floor(sqft * 0.85);
  const maxSqft = Math.ceil(sqft * 1.15);

  const yearBuilt = subjectProperty.yearBuilt || 1960;
  const minYear = yearBuilt - 10;
  const maxYear = yearBuilt + 10;

  // Calculate age range for comparison
  const currentYear = new Date().getFullYear();
  const subjectAge = subjectProperty.yearBuilt ? currentYear - subjectProperty.yearBuilt : 50;
  const minAge = Math.max(0, subjectAge - 10);
  const maxAge = subjectAge + 10;

  // Query for comparables
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
      DATASETS.SALES,
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
    const compValue = parseNumber(propValue.board_tot);
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
      '$order': 'tax_year DESC, stage_name DESC',
      '$limit': String(years * 3) // Multiple stages per year
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

  // Get comparables
  const comparables = await getComparableProperties(property, 15);

  // Get appeal history
  const appealHistory = await getAppealHistory(pin);

  // Calculate analysis
  const compValues = comparables
    .map(c => c.assessedValue)
    .filter((v): v is number => v !== null);

  const medianValue = compValues.length > 0
    ? compValues.sort((a, b) => a - b)[Math.floor(compValues.length / 2)]
    : null;

  const avgValue = compValues.length > 0
    ? compValues.reduce((a, b) => a + b, 0) / compValues.length
    : null;

  const subjectValue = property.assessedValue || 0;

  // Calculate overvaluation
  let estimatedOvervaluation = 0;
  if (medianValue && subjectValue > medianValue) {
    estimatedOvervaluation = subjectValue - medianValue;
  }

  // Estimate tax savings (Cook County effective rate ~2.1%)
  const taxRate = 0.021;
  const estimatedTaxSavings = estimatedOvervaluation * taxRate;

  // Calculate opportunity score (0-100)
  let opportunityScore = 0;

  // Factor 1: Overvaluation percentage (up to 40 points)
  const overvaluationPct = medianValue ? ((subjectValue - medianValue) / medianValue) * 100 : 0;
  opportunityScore += Math.min(40, overvaluationPct * 2);

  // Factor 2: Sample size (up to 20 points)
  opportunityScore += Math.min(20, compValues.length * 2);

  // Factor 3: Consistency of comparables (up to 20 points)
  if (compValues.length >= 3) {
    const valueSpread = Math.max(...compValues) - Math.min(...compValues);
    const avgVal = avgValue || 1;
    const consistency = 1 - (valueSpread / avgVal);
    opportunityScore += Math.max(0, Math.min(20, consistency * 20));
  }

  // Factor 4: Historical appeal success (up to 20 points)
  const hasRecentSuccess = appealHistory.some(
    a => a.change && parseNumber(a.tot_post_mktval) && parseNumber(a.tot_pre_mktval) &&
    parseNumber(a.tot_post_mktval)! < parseNumber(a.tot_pre_mktval)!
  );
  if (hasRecentSuccess) {
    opportunityScore += 10;
  }
  if (overvaluationPct > 15) {
    opportunityScore += 10;
  }

  // Determine appeal grounds
  const appealGrounds: string[] = [];
  if (overvaluationPct > 10) {
    appealGrounds.push('comparable_sales');
  }
  // Could add more grounds detection here

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (compValues.length >= 5 && overvaluationPct > 15) {
    confidence = 'high';
  } else if (compValues.length >= 3 && overvaluationPct > 10) {
    confidence = 'medium';
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
    analysis: {
      opportunityScore: Math.round(Math.min(100, Math.max(0, opportunityScore))),
      estimatedOvervaluation,
      estimatedTaxSavings,
      medianComparableValue: medianValue || 0,
      averageComparableValue: avgValue || 0,
      comparableCount: compValues.length,
      appealGrounds,
      confidence,
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
    DATASETS.SALES,
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
