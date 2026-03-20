/**
 * Vehicle Mismatch Detection
 *
 * Compares the user's registered vehicle (make/model/color from their profile)
 * against what's visible in the camera ticket violation photo/description.
 *
 * This detects the "Susan Bonini" scenario: same plate number on a completely
 * different car (cloned plates, misread plates, or clerical errors).
 *
 * Two modes:
 * 1. USER-REPORTED: User fills in their vehicle info in settings, system compares
 *    against violation description when available
 * 2. FUTURE: Computer vision API analyzes the camera photo directly (requires
 *    capturing photo URLs from the portal and a vehicle recognition API)
 */

export interface VehicleInfo {
  make?: string;   // e.g. "Toyota", "Chevrolet"
  model?: string;  // e.g. "Camry", "Equinox"
  color?: string;  // e.g. "Silver", "Black"
  type?: string;   // e.g. "Sedan", "SUV"
  year?: number;
}

export interface MismatchResult {
  hasMismatch: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  mismatches: MismatchDetail[];
  summary: string;
  defenseText: string;
}

interface MismatchDetail {
  field: string;
  registered: string;
  observed: string;
  severity: 'definitive' | 'strong' | 'supporting';
}

// Common make aliases — "Chevy" = "Chevrolet", etc.
const MAKE_ALIASES: Record<string, string[]> = {
  'chevrolet': ['chevy', 'chev'],
  'volkswagen': ['vw'],
  'mercedes-benz': ['mercedes', 'mb', 'benz'],
  'bmw': ['bayerische'],
  'gmc': ['general motors'],
  'land rover': ['landrover'],
  'alfa romeo': ['alfa'],
};

// Color groups — "dark blue" ≈ "blue", "charcoal" ≈ "gray/black"
const COLOR_GROUPS: Record<string, string[]> = {
  'black': ['black', 'jet black', 'onyx', 'ebony'],
  'white': ['white', 'pearl white', 'ivory', 'snow white', 'arctic white'],
  'silver': ['silver', 'platinum', 'titanium', 'pewter'],
  'gray': ['gray', 'grey', 'charcoal', 'graphite', 'gunmetal', 'slate'],
  'red': ['red', 'crimson', 'burgundy', 'maroon', 'cherry', 'ruby', 'scarlet', 'wine'],
  'blue': ['blue', 'navy', 'dark blue', 'light blue', 'cobalt', 'royal blue', 'midnight blue', 'sapphire'],
  'green': ['green', 'dark green', 'forest green', 'olive', 'lime', 'emerald', 'hunter green'],
  'brown': ['brown', 'tan', 'beige', 'bronze', 'copper', 'mocha', 'khaki', 'sand'],
  'gold': ['gold', 'champagne', 'golden'],
  'orange': ['orange', 'burnt orange', 'tangerine'],
  'yellow': ['yellow', 'cream'],
};

/**
 * Normalize a make name for comparison.
 * "Chevy" → "chevrolet", "VW" → "volkswagen"
 */
function normalizeMake(make: string): string {
  const lower = make.toLowerCase().trim();
  // Check aliases
  for (const [canonical, aliases] of Object.entries(MAKE_ALIASES)) {
    if (lower === canonical || aliases.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}

/**
 * Get the canonical color group for a color string.
 * "Dark Blue" → "blue", "Charcoal" → "gray"
 */
function normalizeColor(color: string): string {
  const lower = color.toLowerCase().trim();
  for (const [group, variants] of Object.entries(COLOR_GROUPS)) {
    if (variants.includes(lower) || lower === group) {
      return group;
    }
  }
  return lower;
}

/**
 * Compare two vehicle descriptions and detect mismatches.
 *
 * @param registered - The user's registered vehicle (from their profile)
 * @param observed - The vehicle observed in the violation (from photo analysis or description)
 * @returns MismatchResult with details about any mismatches found
 */
export function detectVehicleMismatch(
  registered: VehicleInfo,
  observed: VehicleInfo,
): MismatchResult {
  const mismatches: MismatchDetail[] = [];

  // Compare make
  if (registered.make && observed.make) {
    const regMake = normalizeMake(registered.make);
    const obsMake = normalizeMake(observed.make);
    if (regMake !== obsMake) {
      mismatches.push({
        field: 'Make',
        registered: registered.make,
        observed: observed.make,
        severity: 'definitive', // Different make = definitely not the same car
      });
    }
  }

  // Compare model
  if (registered.model && observed.model) {
    const regModel = registered.model.toLowerCase().trim();
    const obsModel = observed.model.toLowerCase().trim();
    // Allow partial matches (e.g. "Equinox" matches "Equinox LT")
    if (!regModel.includes(obsModel) && !obsModel.includes(regModel)) {
      mismatches.push({
        field: 'Model',
        registered: registered.model,
        observed: observed.model,
        severity: 'definitive',
      });
    }
  }

  // Compare color
  if (registered.color && observed.color) {
    const regColor = normalizeColor(registered.color);
    const obsColor = normalizeColor(observed.color);
    if (regColor !== obsColor) {
      // Color-only mismatch could be lighting, so it's "strong" not "definitive"
      // unless it's a dramatic difference (e.g. white vs black)
      const dramaticDifference = isDramaticColorDifference(regColor, obsColor);
      mismatches.push({
        field: 'Color',
        registered: registered.color,
        observed: observed.color,
        severity: dramaticDifference ? 'definitive' : 'strong',
      });
    }
  }

  // Compare type (sedan vs SUV, etc.)
  if (registered.type && observed.type) {
    const regType = registered.type.toLowerCase().trim();
    const obsType = observed.type.toLowerCase().trim();
    if (regType !== obsType) {
      mismatches.push({
        field: 'Vehicle Type',
        registered: registered.type,
        observed: observed.type,
        severity: 'definitive', // Sedan vs SUV = definitely different cars
      });
    }
  }

  // Determine overall confidence
  let confidence: MismatchResult['confidence'] = 'none';
  const definitiveCount = mismatches.filter(m => m.severity === 'definitive').length;
  const strongCount = mismatches.filter(m => m.severity === 'strong').length;

  if (definitiveCount >= 2) confidence = 'high';
  else if (definitiveCount >= 1) confidence = 'high';
  else if (strongCount >= 2) confidence = 'medium';
  else if (strongCount >= 1) confidence = 'low';

  const hasMismatch = mismatches.length > 0;

  // Generate human-readable summary
  const summary = hasMismatch
    ? `Vehicle mismatch detected: ${mismatches.map(m => `${m.field} (registered: ${m.registered}, observed: ${m.observed})`).join('; ')}`
    : 'No vehicle mismatch detected';

  // Generate defense text for contest letters
  const defenseText = generateDefenseText(registered, observed, mismatches);

  return {
    hasMismatch,
    confidence,
    mismatches,
    summary,
    defenseText,
  };
}

/**
 * Check if two colors are dramatically different (not plausibly a lighting issue).
 */
function isDramaticColorDifference(color1: string, color2: string): boolean {
  const dramaticPairs = [
    ['black', 'white'], ['black', 'yellow'], ['black', 'red'],
    ['white', 'blue'], ['white', 'green'], ['white', 'red'],
    ['red', 'blue'], ['red', 'green'], ['green', 'blue'],
    ['yellow', 'blue'], ['yellow', 'green'],
  ];
  return dramaticPairs.some(([a, b]) =>
    (color1 === a && color2 === b) || (color1 === b && color2 === a)
  );
}

/**
 * Generate the defense argument text for a contest letter when a vehicle mismatch is detected.
 */
function generateDefenseText(
  registered: VehicleInfo,
  observed: VehicleInfo,
  mismatches: MismatchDetail[],
): string {
  if (mismatches.length === 0) return '';

  const regDesc = [registered.color, registered.make, registered.model]
    .filter(Boolean).join(' ');
  const obsDesc = [observed.color, observed.make, observed.model]
    .filter(Boolean).join(' ');

  const mismatchDetails = mismatches.map(m =>
    `- ${m.field}: My vehicle is a ${m.registered}; the vehicle in the photo is a ${m.observed}`
  ).join('\n');

  return `VEHICLE IDENTIFICATION ERROR — WRONG VEHICLE

The vehicle shown in the violation photo/video is NOT my vehicle. My registered vehicle is a ${regDesc}, but the vehicle in the citation appears to be a ${obsDesc}.

Specific discrepancies:
${mismatchDetails}

My license plate number may have been duplicated, misread by the camera system, or cloned. This is a known issue — the Illinois Secretary of State's office and Chicago's own Inspector General have documented cases of plates being duplicated or misread by automated enforcement cameras.

Under Chicago Municipal Code § 9-100-060(b), the registered owner is only liable if the vehicle was under their control at the time of the violation. Since the photographed vehicle is clearly not mine, my vehicle was not at the intersection at the time of the alleged violation.

I respectfully request that this citation be dismissed on the grounds that the violation evidence shows a different vehicle than the one registered to my license plate.`;
}

/**
 * Check if a user has sufficient vehicle info for mismatch detection.
 */
export function hasVehicleInfoForMismatch(info: VehicleInfo): boolean {
  // Need at least make OR (color + type) to do meaningful comparison
  return !!(info.make || (info.color && info.type));
}

/**
 * Extract vehicle info from a violation description string.
 * Camera ticket descriptions sometimes include vehicle details like
 * "RED LIGHT - BLK CHEVY SUV" or similar abbreviated forms.
 *
 * This is a best-effort parser for the city's ticket descriptions.
 */
export function parseVehicleFromDescription(description: string): VehicleInfo | null {
  if (!description) return null;
  const upper = description.toUpperCase();

  const result: VehicleInfo = {};

  // Common abbreviated colors in ticket descriptions
  const colorAbbrevs: Record<string, string> = {
    'BLK': 'Black', 'WHT': 'White', 'SLV': 'Silver', 'GRY': 'Gray',
    'RED': 'Red', 'BLU': 'Blue', 'GRN': 'Green', 'BRN': 'Brown',
    'TAN': 'Tan', 'GLD': 'Gold', 'ORG': 'Orange', 'YEL': 'Yellow',
    'MRN': 'Maroon', 'BGE': 'Beige', 'CRM': 'Cream',
  };

  for (const [abbrev, color] of Object.entries(colorAbbrevs)) {
    if (upper.includes(abbrev)) {
      result.color = color;
      break;
    }
  }

  // Common make abbreviations
  const makeAbbrevs: Record<string, string> = {
    'CHEV': 'Chevrolet', 'CHEVY': 'Chevrolet', 'FORD': 'Ford',
    'TOYO': 'Toyota', 'HOND': 'Honda', 'NISS': 'Nissan',
    'HYUN': 'Hyundai', 'KIA': 'Kia', 'BMW': 'BMW',
    'MERC': 'Mercedes-Benz', 'AUDI': 'Audi', 'LEXU': 'Lexus',
    'ACUR': 'Acura', 'JEEP': 'Jeep', 'DODG': 'Dodge',
    'BUIC': 'Buick', 'CADI': 'Cadillac', 'GMC': 'GMC',
    'SUBA': 'Subaru', 'MAZD': 'Mazda', 'VOLV': 'Volvo',
    'MITS': 'Mitsubishi', 'INFI': 'Infiniti', 'LINC': 'Lincoln',
    'CHRY': 'Chrysler', 'PONT': 'Pontiac', 'RAMS': 'Ram',
    'TESL': 'Tesla', 'VOLK': 'Volkswagen',
  };

  for (const [abbrev, make] of Object.entries(makeAbbrevs)) {
    if (upper.includes(abbrev)) {
      result.make = make;
      break;
    }
  }

  // Vehicle type
  const typeKeywords: Record<string, string> = {
    'SUV': 'SUV', 'SEDAN': 'Sedan', 'TRUCK': 'Truck', 'PICKUP': 'Truck',
    'VAN': 'Van', 'MINIVAN': 'Van', 'COUPE': 'Sedan', 'HATCHBACK': 'Sedan',
    'WAGON': 'Sedan', 'CONVERTIBLE': 'Sedan', 'MOTORCYCLE': 'Motorcycle',
  };

  for (const [keyword, type] of Object.entries(typeKeywords)) {
    if (upper.includes(keyword)) {
      result.type = type;
      break;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
