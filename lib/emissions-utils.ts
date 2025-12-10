/**
 * VIN-based Emissions Eligibility Calculator
 *
 * Illinois emissions testing rules:
 * - Vehicles are exempt for first 4 years from model year
 * - Even model year vehicles test in even calendar years
 * - Odd model year vehicles test in odd calendar years
 * - Testing month = license plate expiration month
 * - Diesel, electric, and hybrid-electric vehicles are exempt
 * - Model year 1967 or before are exempt
 * - Motorcycles are exempt
 */

// VIN model year codes (position 10)
const VIN_YEAR_CODES: { [key: string]: number } = {
  'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014,
  'F': 2015, 'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019,
  'L': 2020, 'M': 2021, 'N': 2022, 'P': 2023, 'R': 2024,
  'S': 2025, 'T': 2026, 'V': 2027, 'W': 2028, 'X': 2029,
  'Y': 2030, '1': 2031, '2': 2032, '3': 2033, '4': 2034,
  '5': 2035, '6': 2036, '7': 2037, '8': 2038, '9': 2039,
  // Legacy codes (1980-2009)
  // Note: This creates ambiguity with 2010+ but context usually helps
};

// VIN year codes for 1980-2009 (same letters, different base)
const VIN_YEAR_CODES_LEGACY: { [key: string]: number } = {
  'A': 1980, 'B': 1981, 'C': 1982, 'D': 1983, 'E': 1984,
  'F': 1985, 'G': 1986, 'H': 1987, 'J': 1988, 'K': 1989,
  'L': 1990, 'M': 1991, 'N': 1992, 'P': 1993, 'R': 1994,
  'S': 1995, 'T': 1996, 'V': 1997, 'W': 1998, 'X': 1999,
  'Y': 2000, '1': 2001, '2': 2002, '3': 2003, '4': 2004,
  '5': 2005, '6': 2006, '7': 2007, '8': 2008, '9': 2009,
};

export interface EmissionsEligibility {
  requiresTesting: boolean;
  reason: string;
  modelYear: number | null;
  nextTestYear: number | null;
  nextTestMonth: number | null;
  isExempt: boolean;
  exemptionReason: string | null;
}

/**
 * Extract model year from VIN (position 10)
 * Note: VIN year codes repeat every 30 years, so we use context to disambiguate
 */
export function getModelYearFromVIN(vin: string): number | null {
  if (!vin || vin.length < 10) {
    return null;
  }

  const yearChar = vin[9].toUpperCase();
  const currentYear = new Date().getFullYear();

  // First try modern codes (2010+)
  if (VIN_YEAR_CODES[yearChar]) {
    const modernYear = VIN_YEAR_CODES[yearChar];
    // If the year is in the future (more than 1 year ahead), use legacy
    if (modernYear > currentYear + 1) {
      // Probably a legacy code
      return VIN_YEAR_CODES_LEGACY[yearChar] || null;
    }
    return modernYear;
  }

  return null;
}

/**
 * Check if vehicle fuel type is exempt (diesel, electric)
 * This is a basic check - position 4 and 8 can indicate engine type
 */
export function checkFuelTypeExemption(vin: string): { exempt: boolean; reason: string | null } {
  if (!vin || vin.length < 17) {
    return { exempt: false, reason: null };
  }

  // This is a simplified check - real VIN decoding would need manufacturer-specific logic
  // Position 4-8 typically indicate vehicle attributes including engine type
  // For now, we'll rely on user-provided fuel type rather than VIN decoding

  return { exempt: false, reason: null };
}

/**
 * Calculate emissions eligibility for a vehicle
 *
 * @param vin - 17-character Vehicle Identification Number
 * @param plateExpiryDate - License plate expiration date (YYYY-MM-DD format)
 * @param vehicleType - Optional: 'gas', 'diesel', 'electric', 'hybrid', 'motorcycle'
 */
export function calculateEmissionsEligibility(
  vin: string,
  plateExpiryDate: string,
  vehicleType?: 'gas' | 'diesel' | 'electric' | 'hybrid' | 'motorcycle'
): EmissionsEligibility {
  const currentYear = new Date().getFullYear();
  const currentDate = new Date();

  // Default result
  const result: EmissionsEligibility = {
    requiresTesting: false,
    reason: '',
    modelYear: null,
    nextTestYear: null,
    nextTestMonth: null,
    isExempt: false,
    exemptionReason: null,
  };

  // Check vehicle type exemptions first
  if (vehicleType === 'diesel') {
    result.isExempt = true;
    result.exemptionReason = 'Diesel vehicles are exempt from Illinois emissions testing';
    result.reason = result.exemptionReason;
    return result;
  }

  if (vehicleType === 'electric') {
    result.isExempt = true;
    result.exemptionReason = 'Electric vehicles are exempt from Illinois emissions testing';
    result.reason = result.exemptionReason;
    return result;
  }

  if (vehicleType === 'motorcycle') {
    result.isExempt = true;
    result.exemptionReason = 'Motorcycles are exempt from Illinois emissions testing';
    result.reason = result.exemptionReason;
    return result;
  }

  // Extract model year from VIN
  const modelYear = getModelYearFromVIN(vin);
  result.modelYear = modelYear;

  if (!modelYear) {
    result.reason = 'Unable to determine model year from VIN';
    return result;
  }

  // Check age exemptions
  if (modelYear <= 1967) {
    result.isExempt = true;
    result.exemptionReason = 'Vehicles model year 1967 or earlier are exempt';
    result.reason = result.exemptionReason;
    return result;
  }

  // Check 4-year new vehicle exemption
  const vehicleAge = currentYear - modelYear;
  if (vehicleAge < 4) {
    result.isExempt = true;
    result.exemptionReason = `Vehicles less than 4 years old are exempt (first test year: ${modelYear + 4})`;
    result.reason = result.exemptionReason;
    result.nextTestYear = modelYear + 4;
    return result;
  }

  // Vehicle requires testing - calculate when
  result.requiresTesting = true;

  // Parse plate expiry to get test month
  const plateExpiry = new Date(plateExpiryDate);
  const plateExpiryMonth = plateExpiry.getMonth() + 1; // 1-12
  result.nextTestMonth = plateExpiryMonth;

  // Biennial testing: even model years test in even calendar years, odd in odd
  const isEvenModelYear = modelYear % 2 === 0;
  const isEvenCurrentYear = currentYear % 2 === 0;

  let nextTestYear: number;
  if (isEvenModelYear === isEvenCurrentYear) {
    // Test is this year or just passed
    // Check if we're past the test month
    const testDeadline = new Date(currentYear, plateExpiryMonth - 1, plateExpiry.getDate());
    if (currentDate > testDeadline) {
      // Missed this year's window, next test in 2 years
      nextTestYear = currentYear + 2;
    } else {
      nextTestYear = currentYear;
    }
  } else {
    // Test is next year
    nextTestYear = currentYear + 1;
  }

  result.nextTestYear = nextTestYear;
  result.reason = `${modelYear} vehicle - emissions test required in ${nextTestYear} during plate expiry month (${getMonthName(plateExpiryMonth)})`;

  return result;
}

/**
 * Calculate exact emissions deadline date
 */
export function getEmissionsDeadline(
  plateExpiryDate: string,
  modelYear: number
): Date | null {
  const currentYear = new Date().getFullYear();
  const currentDate = new Date();

  // Parse plate expiry
  const plateExpiry = new Date(plateExpiryDate);
  const expiryMonth = plateExpiry.getMonth();
  const expiryDay = plateExpiry.getDate();

  // Check if vehicle is exempt (< 4 years old)
  if (currentYear - modelYear < 4) {
    return null; // Exempt
  }

  // Calculate test year using biennial rule
  const isEvenModelYear = modelYear % 2 === 0;
  const isEvenCurrentYear = currentYear % 2 === 0;

  let testYear: number;
  if (isEvenModelYear === isEvenCurrentYear) {
    testYear = currentYear;
    // If we've passed this year's deadline, next test is in 2 years
    const deadlineThisYear = new Date(currentYear, expiryMonth, expiryDay);
    if (currentDate > deadlineThisYear) {
      testYear = currentYear + 2;
    }
  } else {
    testYear = currentYear + 1;
  }

  // Deadline is plate expiry date in the test year
  return new Date(testYear, expiryMonth, expiryDay);
}

/**
 * Helper to get month name
 */
function getMonthName(month: number): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[month - 1] || 'Unknown';
}

/**
 * Validate VIN format
 */
export function isValidVIN(vin: string): boolean {
  if (!vin || vin.length !== 17) {
    return false;
  }

  // VIN should only contain alphanumeric characters except I, O, Q
  const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/i;
  return vinRegex.test(vin);
}

/**
 * Get vehicle info summary from VIN for display
 */
export function getVINSummary(vin: string): string {
  if (!isValidVIN(vin)) {
    return 'Invalid VIN';
  }

  const modelYear = getModelYearFromVIN(vin);
  if (!modelYear) {
    return 'Unable to decode VIN';
  }

  return `${modelYear} model year vehicle`;
}
