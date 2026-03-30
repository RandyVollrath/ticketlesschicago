#!/usr/bin/env node
/**
 * Import 2026 Street Cleaning Schedule from City of Chicago CSV
 *
 * Parses CSV with ward/section/boundary/date data, converts Chicago address grid
 * boundaries to lat/lng polygon coordinates, and uploads both schedule data and
 * zone geometry to Supabase.
 *
 * Usage: node scripts/import-2026-street-cleaning.js [path-to-csv]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// ── Supabase clients ──────────────────────────────────────────────
const taSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const mscSupabase = process.env.MSC_SUPABASE_URL && process.env.MSC_SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.MSC_SUPABASE_URL, process.env.MSC_SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ── Chicago Grid Constants ────────────────────────────────────────
// Origin: State & Madison intersection
const GRID_ORIGIN_LAT = 41.88195;   // Madison St (0 N/S)
const GRID_ORIGIN_LNG = -87.62784;  // State St (0 E/W)

// Conversion factors (empirically calibrated to Chicago)
// 800 addresses = 1 mile
// At 41.88° N: 1° lat = 69.05 mi, 1° lng = 51.52 mi
const LAT_PER_ADDR = 1 / (69.05 * 800);  // ~0.00001812° per address unit
const LNG_PER_ADDR = 1 / (51.52 * 800);  // ~0.00002426° per address unit

function gridToLat(gridNum, direction) {
  const dir = normalizeDirection(direction);
  if (dir === 'N' || dir === 'NORTH') {
    return GRID_ORIGIN_LAT + gridNum * LAT_PER_ADDR;
  } else if (dir === 'S' || dir === 'SOUTH') {
    return GRID_ORIGIN_LAT - gridNum * LAT_PER_ADDR;
  }
  // For E/W directions being used as N/S boundary (shouldn't happen but fallback)
  return GRID_ORIGIN_LAT;
}

function gridToLng(gridNum, direction) {
  const dir = normalizeDirection(direction);
  if (dir === 'W' || dir === 'WEST') {
    return GRID_ORIGIN_LNG - gridNum * LNG_PER_ADDR;
  } else if (dir === 'E' || dir === 'EAST') {
    return GRID_ORIGIN_LNG + gridNum * LNG_PER_ADDR;
  }
  return GRID_ORIGIN_LNG;
}

function normalizeDirection(dir) {
  if (!dir) return null;
  const d = dir.toUpperCase().trim();
  if (d === 'W') return 'WEST';
  if (d === 'E') return 'EAST';
  if (d === 'N') return 'NORTH';
  if (d === 'S') return 'SOUTH';
  if (d === 'N/S' || d === 'E/W' || d === '0/0') return 'CENTER';
  return d;
}

// ── Grid Number Extraction ────────────────────────────────────────
function extractGridNumber(boundaryStr) {
  if (!boundaryStr || !boundaryStr.trim()) return null;
  let s = boundaryStr.trim();

  // Fix known typos in direction strings
  s = s.replace(/Souht\b/i, 'South');
  s = s.replace(/Sotuh\b/i, 'South');
  s = s.replace(/South0\b/i, 'South)');
  s = s.replace(/Streeet/i, 'Street');

  // Pattern: "(0 E/W)" or "(0 N/S)" or "(0 W/E)" - grid origin
  let m = s.match(/\(\s*0\s+(E\/W|W\/E|N\/S|S\/N)\s*\)/i);
  if (m) return { num: 0, dir: 'CENTER' };

  // Pattern: "State/Madison (0 ...)" variations
  if (/\b(state|madison)\b/i.test(s) && /\b0\s+(E\/W|W\/E|N\/S|S\/N|E|W|N|S)\b/i.test(s)) {
    return { num: 0, dir: 'CENTER' };
  }

  // Pattern 1: "Street Name (NUMBER Direction)" - most common
  m = s.match(/\(\s*(\d+)\s+(West|East|North|South|W|E|N|S)\s*\)/i);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: normalizeDirection(m[2]) };

  // Pattern 2: "Street Name (NUMBER Direction" - missing close paren
  m = s.match(/\(?\s*(\d+)\s+(West|East|North|South|W|E|N|S)\s*\)?$/i);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: normalizeDirection(m[2]) };

  // Pattern 3: "Street Name NUMBER Dir" - no parens (e.g., "Clark 100 W")
  m = s.match(/\s(\d+)\s+(West|East|North|South|W|E|N|S)\b/i);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: normalizeDirection(m[2]) };

  // Pattern 4: "NUMBER Direction)" - missing open paren (e.g., "68th Street 6800 South)")
  m = s.match(/(\d+)\s+(West|East|North|South|W|E|N|S)\s*\)/i);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: normalizeDirection(m[2]) };

  // Pattern 5: Just number in parens "(4600)" - direction inferred from context
  m = s.match(/\((\d+)\)/);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: null };

  // Pattern 6: "Street (NUMBER)" with no direction
  m = s.match(/\(\s*(\d+)\s*\)/);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: null };

  // Pattern 7: "0/0" or "State" or "Madison" at grid origin
  if (s.includes('0/0')) {
    return { num: 0, dir: 'CENTER' };
  }
  if (/^state\b/i.test(s) && /\b0\b/.test(s)) {
    return { num: 0, dir: 'CENTER' };
  }
  if (/^madison\b/i.test(s) && /\b0\b/.test(s)) {
    return { num: 0, dir: 'CENTER' };
  }

  // Pattern 8: "NUMBER Dir)" missing open paren
  m = s.match(/(\d{3,5})\s*(West|East|North|South|W|E|N|S)\s*\)/i);
  if (m) return { num: fixGridTypo(parseInt(m[1])), dir: normalizeDirection(m[2]) };

  // Pattern 9: "Lake Michigan (1000 West)" - treat as East lakefront
  if (/lake michigan/i.test(s)) {
    m = s.match(/\((\d+)/);
    return { num: m ? parseInt(m[1]) : 500, dir: 'EAST' };
  }

  return null;
}

// Manual overrides for zones with garbled/missing CSV data
// Format: 'ward-section': { east: {num, dir}, west: {num, dir}, north: {num, dir}, south: {num, dir} }
const ZONE_OVERRIDES = {
  // Ward 5 Sec 18/19: Midway Plaisance area, columns misaligned in CSV
  '5-18': {
    north: { num: 5900, dir: 'SOUTH' },  // Midway Plaisance (5900 S)
    south: { num: 6000, dir: 'SOUTH' },  // South of Midway (approx 60th)
    east: { num: 800, dir: 'EAST' },     // Cottage Grove
    west: { num: 1300, dir: 'EAST' },    // Kimbark
  },
  '5-19': {
    north: { num: 5900, dir: 'SOUTH' },
    south: { num: 6000, dir: 'SOUTH' },
    east: { num: 1300, dir: 'EAST' },    // Kimbark
    west: { num: 1600, dir: 'EAST' },    // Stony Island
  },
  // Ward 49 Sec 10: Lake Michigan east, missing west boundary
  '49-10': {
    east: { num: 1000, dir: 'EAST' },    // Lakefront
    west: { num: 1400, dir: 'WEST' },    // Approximate western boundary (Glenwood)
    north: { num: 6800, dir: 'NORTH' },  // Pratt
    south: { num: 7200, dir: 'NORTH' },  // Touhy (7200 N, not W as in CSV)
  },
};

// Fix common data-entry typos in grid numbers
function fixGridTypo(num) {
  // Pattern 1: Leading "9" typo: 911400 → 11400, 911000 → 11000
  if (num > 90000 && String(num).startsWith('9')) {
    const stripped = parseInt(String(num).substring(1));
    if (stripped >= 1000 && stripped <= 15000) return stripped;
  }
  // Pattern 2: Extra zero: 98000 → 9800, 87000 → 8700, 107000 → 10700
  if (num > 15000 && num % 1000 === 0) {
    return num / 10;
  }
  if (num > 15000 && num % 100 === 0) {
    return num / 10;
  }
  return num;
}

// ── Diagonal Street Models ────────────────────────────────────────
// For diagonal streets used as zone boundaries, we model their grid position
// as a linear function of the perpendicular coordinate.
// Format: { slope: dW/dN, refN, refW } means W = refW + slope * (N - refN)
// where N is the N/S grid number and W is the E/W grid number

const DIAGONAL_STREETS = {
  'kennedy expressway': {
    // I-90/94 through Chicago
    // Reference: At North Ave (1600N) ≈ 1400W, at Foster (5200N) ≈ 4400W
    slope: (4400 - 1400) / (5200 - 1600), // ≈ 0.833
    refN: 1600,
    refW: 1400,
    direction: 'WEST'
  },
  'milwaukee': {
    // Milwaukee Ave from Loop NW
    // Reference: At Division (1200N) ≈ 1400W, at Devon (6400N) ≈ 6200W
    slope: (6200 - 1400) / (6400 - 1200), // ≈ 0.923
    refN: 1200,
    refW: 1400,
    direction: 'WEST'
  },
  'milwaukee ave': null, // Alias
  'milwaukee avenue': null, // Alias
  'archer ave': {
    // Archer runs from Loop SW
    // At 35th (3500S) ≈ 2000W, at 55th (5500S) ≈ 5800W
    slope: (5800 - 2000) / (5500 - 3500), // = 1.9
    refS: 3500,
    refW: 2000,
    direction: 'SOUTH', // Uses south grid
    isSouth: true,
  },
  'archer avenue': null, // Alias
  'northwest highway': {
    // NW Highway from Irving Park NW to Howard
    // At Foster (5200N) ≈ 5700W, at Devon (6400N) ≈ 6800W
    slope: (6800 - 5700) / (6400 - 5200), // ≈ 0.917
    refN: 5200,
    refW: 5700,
    direction: 'WEST'
  },
  'higgins': {
    // Higgins Rd runs NW from near Foster/Central to O'Hare area
    // At Montrose (4400N) ≈ 5000W, at Foster (5200N) ≈ 5800W
    slope: (5800 - 5000) / (5200 - 4400), // = 1.0
    refN: 4400,
    refW: 5000,
    direction: 'WEST'
  },
  'avondale': {
    // Avondale Ave, short diagonal in NW
    // At Montrose (4400N) ≈ 4200W, at Foster (5200N) ≈ 5000W
    slope: (5000 - 4200) / (5200 - 4400), // = 1.0
    refN: 4400,
    refW: 4200,
    direction: 'WEST'
  },
  'elston avenue': {
    // Elston Ave runs NW
    // At Diversey (2800N) ≈ 2600W, at Montrose (4400N) ≈ 4000W
    slope: (4000 - 2600) / (4400 - 2800), // ≈ 0.875
    refN: 2800,
    refW: 2600,
    direction: 'WEST'
  },
  'chicago river': {
    // North Branch Chicago River (simplified)
    // At Kinzie (400N) ≈ 400W, at Lawrence (4800N) ≈ 2800W
    slope: (2800 - 400) / (4800 - 400), // ≈ 0.545
    refN: 400,
    refW: 400,
    direction: 'WEST'
  },
  'river': null, // Alias for Chicago River
};

// Resolve alias
for (const [key, val] of Object.entries(DIAGONAL_STREETS)) {
  if (val === null) {
    // Find the base entry
    const base = key.replace(/ (ave|avenue)$/i, '').replace(/^chicago /, '');
    for (const [k, v] of Object.entries(DIAGONAL_STREETS)) {
      if (v && k.includes(base)) {
        DIAGONAL_STREETS[key] = v;
        break;
      }
    }
  }
}

// ── Static Street Lookups ─────────────────────────────────────────
// For streets that appear without grid numbers and aren't diagonal
const STATIC_STREET_GRID = {
  'lake shore drive': { num: 500, dir: 'EAST' },
  'lake shore drive west': { num: 500, dir: 'EAST' },
  'lake front': { num: 1600, dir: 'EAST' },  // South side lakefront
  'stony island': { num: 1600, dir: 'EAST' },
  'state st 0/0': { num: 0, dir: 'CENTER' },
  'torrence e': { num: 2634, dir: 'EAST' },
  'bensley w': { num: 2600, dir: 'EAST' },  // Bensley Ave ≈ 2600E
  'st. lawrence e': { num: 600, dir: 'EAST' },
  'indiana w': { num: 200, dir: 'EAST' },  // Indiana Ave ≈ 200E
  'ridge to clark': { num: 1700, dir: 'WEST' },  // Ridge Blvd area in Edgewater
};

// ── Resolve Boundary to Grid Coordinates ──────────────────────────
/**
 * Resolves a boundary string to a grid coordinate.
 * @param {string} boundaryStr - The raw boundary string from CSV
 * @param {'east'|'west'|'north'|'south'} fieldType - Which boundary this is
 * @param {object} otherBounds - The other parsed boundaries for context
 * @returns {{ num: number, dir: string } | null}
 */
function resolveBoundary(boundaryStr, fieldType, otherBounds) {
  if (!boundaryStr || !boundaryStr.trim()) return null;
  const s = boundaryStr.trim();
  const sLower = s.toLowerCase();

  // Try direct grid extraction first
  const direct = extractGridNumber(s);
  if (direct) {
    // If direction is missing, infer from field type and number magnitude
    if (!direct.dir || direct.dir === null) {
      if (fieldType === 'east' || fieldType === 'west') {
        // E/W boundary - number is a W or E grid number
        direct.dir = direct.num > 400 ? 'WEST' : 'EAST';
      } else {
        // N/S boundary - number is a N or S grid number
        direct.dir = direct.num > 2000 ? 'SOUTH' : 'NORTH';
      }
    }
    return direct;
  }

  // Check static lookups
  const staticResult = STATIC_STREET_GRID[sLower];
  if (staticResult) return { ...staticResult };

  // Handle "43rd Street (South)" - the "(South)" is a direction label, not a grid direction
  if (sLower.includes('43rd street') && sLower.includes('south')) {
    return { num: 4300, dir: 'SOUTH' };
  }

  // Check diagonal streets
  const diagKey = Object.keys(DIAGONAL_STREETS).find(k => sLower.includes(k) || sLower === k);
  if (diagKey && DIAGONAL_STREETS[diagKey]) {
    const diag = DIAGONAL_STREETS[diagKey];
    // Calculate position based on the perpendicular coordinate from other bounds
    if (diag.isSouth) {
      // Archer-like: uses S grid, need E-W position from context
      // For E/W boundaries, use the N/S midpoint
      if (fieldType === 'north' || fieldType === 'south') {
        // This is a N/S boundary (horizontal), so diagonal gives S position at midpoint W
        const midW = getMidpoint(otherBounds, 'ew');
        if (midW !== null) {
          const sPos = diag.refS + (midW - diag.refW) / diag.slope;
          return { num: Math.round(sPos), dir: 'SOUTH' };
        }
      } else {
        // E/W boundary, diagonal gives W position at midpoint S
        const midS = getMidpoint(otherBounds, 'ns_south');
        if (midS !== null) {
          const wPos = diag.refW + diag.slope * (midS - diag.refS);
          return { num: Math.round(wPos), dir: 'WEST' };
        }
      }
    } else {
      // Kennedy/Milwaukee-like: uses N grid
      if (fieldType === 'east' || fieldType === 'west') {
        // E/W boundary, diagonal gives W position at midpoint N
        const midN = getMidpoint(otherBounds, 'ns');
        if (midN !== null) {
          const wPos = diag.refW + diag.slope * (midN - diag.refN);
          return { num: Math.round(Math.abs(wPos)), dir: diag.direction };
        }
      } else {
        // N/S boundary, diagonal gives N position at midpoint W
        const midW = getMidpoint(otherBounds, 'ew');
        if (midW !== null) {
          const nPos = diag.refN + (midW - diag.refW) / diag.slope;
          return { num: Math.round(Math.abs(nPos)), dir: 'NORTH' };
        }
      }
    }
    // Fallback for diagonal: use reference point
    return { num: diag.refW, dir: diag.direction };
  }

  // If we get here, log and return null
  return null;
}

function getMidpoint(bounds, type) {
  if (type === 'ns') {
    // Get midpoint of N/S boundaries (for zones on the north side)
    if (bounds.north && bounds.south) {
      return (bounds.north + bounds.south) / 2;
    }
    return bounds.north || bounds.south || null;
  }
  if (type === 'ns_south') {
    // Get midpoint of N/S boundaries for south-side zones
    if (bounds.north && bounds.south) {
      return (bounds.north + bounds.south) / 2;
    }
    return bounds.north || bounds.south || null;
  }
  if (type === 'ew') {
    if (bounds.east && bounds.west) {
      return (bounds.east + bounds.west) / 2;
    }
    return bounds.east || bounds.west || null;
  }
  return null;
}

// ── Date Normalization ────────────────────────────────────────────
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.trim();

  // Format: MM-DD-YYYY (e.g., "04-01-2026")
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // Format: MM/DD/YY (e.g., "06/26/26")
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const year = parseInt(m[3]) + 2000;
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // Format: MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // Format: YYYY-MM-DD (already correct)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;

  console.warn(`⚠️  Unparseable date: "${s}"`);
  return null;
}

// ── CSV Parser (handles quoted fields with commas) ────────────────
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0]);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] || '').trim();
    }
    rows.push(row);
  }
  return rows;
}

// ── Build Zone Polygons ───────────────────────────────────────────
function buildZoneData(csvRows) {
  // Extract unique zones
  const zoneMap = new Map();
  const scheduleRows = [];

  for (const row of csvRows) {
    const ward = row.ward?.trim();
    const section = row.section?.trim();
    const date = normalizeDate(row.cleaning_date);

    if (!ward || !section) continue;

    // Schedule data
    if (date) {
      scheduleRows.push({ ward, section, cleaning_date: date });
    }

    // Zone boundaries (only need one per ward/section)
    const key = `${ward}-${section}`;
    if (!zoneMap.has(key)) {
      zoneMap.set(key, {
        ward,
        section,
        east_block: row.east_block?.trim() || '',
        west_block: row.west_block?.trim() || '',
        north_boundary: row.north_boundary?.trim() || '',
        south_boundary: row.south_boundary?.trim() || '',
      });
    }
  }

  console.log(`📊 Found ${zoneMap.size} unique zones and ${scheduleRows.length} schedule rows`);

  // Convert boundaries to polygons
  const zones = [];
  let successCount = 0;
  let failCount = 0;
  const failures = [];

  for (const [key, zone] of zoneMap) {
    // Check manual overrides first
    const override = ZONE_OVERRIDES[key];
    if (override) {
      const { east, west, north, south } = override;
      const eastLng = gridToLng(east.num, east.dir);
      const westLng = gridToLng(west.num, west.dir);
      const northLat = gridToLat(north.num, north.dir);
      const southLat = gridToLat(south.num, south.dir);
      const polygon = {
        type: 'Polygon',
        coordinates: [[
          [Math.min(eastLng, westLng), Math.min(northLat, southLat)],
          [Math.max(eastLng, westLng), Math.min(northLat, southLat)],
          [Math.max(eastLng, westLng), Math.max(northLat, southLat)],
          [Math.min(eastLng, westLng), Math.max(northLat, southLat)],
          [Math.min(eastLng, westLng), Math.min(northLat, southLat)],
        ]]
      };
      zones.push({
        ward: zone.ward, section: zone.section, polygon,
        eastLng: Math.max(eastLng, westLng), westLng: Math.min(eastLng, westLng),
        northLat: Math.max(northLat, southLat), southLat: Math.min(northLat, southLat),
        east_block: zone.east_block, west_block: zone.west_block,
        north_boundary: zone.north_boundary, south_boundary: zone.south_boundary,
      });
      successCount++;
      continue;
    }

    // First pass: extract what we can directly
    const rawBounds = {
      east: extractGridNumber(zone.east_block),
      west: extractGridNumber(zone.west_block),
      north: extractGridNumber(zone.north_boundary),
      south: extractGridNumber(zone.south_boundary),
    };

    // Build partial numeric bounds for context
    const numericBounds = {};
    for (const [field, parsed] of Object.entries(rawBounds)) {
      if (parsed) {
        numericBounds[field] = parsed.num;
      }
    }

    // Second pass: resolve unparseable boundaries using context
    const bounds = {};
    for (const [field, fieldName] of [['east', 'east_block'], ['west', 'west_block'], ['north', 'north_boundary'], ['south', 'south_boundary']]) {
      const parsed = rawBounds[field] || resolveBoundary(zone[fieldName], field, numericBounds);
      if (parsed) {
        bounds[field] = parsed;
      }
    }

    // Validate we have all 4 boundaries
    if (!bounds.east || !bounds.west || !bounds.north || !bounds.south) {
      const missing = ['east', 'west', 'north', 'south'].filter(f => !bounds[f]);
      failures.push(`Ward ${zone.ward} Sec ${zone.section}: missing ${missing.join(', ')} [${missing.map(f => zone[f === 'east' ? 'east_block' : f === 'west' ? 'west_block' : f === 'north' ? 'north_boundary' : 'south_boundary']).join(', ')}]`);
      failCount++;
      continue;
    }

    // Infer missing directions
    inferDirection(bounds.east, 'east', zone);
    inferDirection(bounds.west, 'west', zone);
    inferDirection(bounds.north, 'north', zone);
    inferDirection(bounds.south, 'south', zone);

    // Strategy: Try direction-based conversion first. If we get 2 lats + 2 lngs, great.
    // Otherwise fall back to column-based (east/west → lng, north/south → lat).
    const allBounds = [
      { field: 'east', ...bounds.east },
      { field: 'west', ...bounds.west },
      { field: 'north', ...bounds.north },
      { field: 'south', ...bounds.south },
    ];

    let lats = [];
    let lngs = [];
    for (const c of allBounds) {
      if (c.dir === 'NORTH' || c.dir === 'SOUTH') {
        lats.push({ val: gridToLat(c.num, c.dir), field: c.field });
      } else {
        lngs.push({ val: gridToLng(c.num, c.dir), field: c.field });
      }
    }

    let eastLng, westLng, northLat, southLat;
    if (lats.length >= 2 && lngs.length >= 2) {
      // Direction-based split works
      northLat = Math.max(...lats.map(l => l.val));
      southLat = Math.min(...lats.map(l => l.val));
      eastLng = Math.max(...lngs.map(l => l.val));
      westLng = Math.min(...lngs.map(l => l.val));
    } else {
      // Fallback: use column names to determine axis
      // east_block/west_block → longitude, north_boundary/south_boundary → latitude
      const wardNum = parseInt(zone.ward);
      const isSouth = SOUTH_SIDE_WARDS.has(wardNum);

      const eastDir = isSouth && bounds.east.num < 3000 && EAST_SIDE_WARDS.has(wardNum) ? 'EAST' : 'WEST';
      const westDir = isSouth && bounds.west.num < 3000 && EAST_SIDE_WARDS.has(wardNum) ? 'EAST' : 'WEST';
      const northDir = isSouth ? 'SOUTH' : 'NORTH';
      const southDir = isSouth ? 'SOUTH' : 'NORTH';

      eastLng = gridToLng(bounds.east.num, bounds.east.dir === 'EAST' || bounds.east.dir === 'WEST' ? bounds.east.dir : eastDir);
      westLng = gridToLng(bounds.west.num, bounds.west.dir === 'EAST' || bounds.west.dir === 'WEST' ? bounds.west.dir : westDir);
      northLat = gridToLat(bounds.north.num, bounds.north.dir === 'NORTH' || bounds.north.dir === 'SOUTH' ? bounds.north.dir : northDir);
      southLat = gridToLat(bounds.south.num, bounds.south.dir === 'NORTH' || bounds.south.dir === 'SOUTH' ? bounds.south.dir : southDir);
    }
    if (northLat < southLat) {
      [northLat, southLat] = [southLat, northLat];
    }

    // Validate reasonable bounds (within Chicago metro)
    if (northLat < 41.55 || northLat > 42.1 || southLat < 41.55 || southLat > 42.1) {
      failures.push(`Ward ${zone.ward} Sec ${zone.section}: lat out of range (${southLat.toFixed(4)} to ${northLat.toFixed(4)})`);
      failCount++;
      continue;
    }
    if (eastLng < -88.0 || eastLng > -87.3 || westLng < -88.0 || westLng > -87.3) {
      failures.push(`Ward ${zone.ward} Sec ${zone.section}: lng out of range (${westLng.toFixed(4)} to ${eastLng.toFixed(4)})`);
      failCount++;
      continue;
    }

    // Create GeoJSON polygon (rectangle)
    // Coordinates: [lng, lat] per GeoJSON spec, counter-clockwise
    const polygon = {
      type: 'Polygon',
      coordinates: [[
        [westLng, southLat],  // SW corner
        [eastLng, southLat],  // SE corner
        [eastLng, northLat],  // NE corner
        [westLng, northLat],  // NW corner
        [westLng, southLat],  // Close ring
      ]]
    };

    zones.push({
      ward: zone.ward,
      section: zone.section,
      polygon,
      eastLng, westLng, northLat, southLat,
      east_block: zone.east_block,
      west_block: zone.west_block,
      north_boundary: zone.north_boundary,
      south_boundary: zone.south_boundary,
    });
    successCount++;
  }

  console.log(`\n✅ Successfully converted ${successCount} zones to polygons`);
  if (failCount > 0) {
    console.log(`⚠️  Failed to convert ${failCount} zones:`);
    failures.forEach(f => console.log(`   ${f}`));
  }

  return { zones, scheduleRows };
}

// South-side wards (Chicago ward geography)
const SOUTH_SIDE_WARDS = new Set([3,4,5,6,7,8,9,10,11,13,15,16,17,18,19,20,21,22,23,24,25,34]);
// East-side wards (east of State St / have East addresses)
const EAST_SIDE_WARDS = new Set([2,3,4,5,6,7,8,10,42,43,44,46,48,49]);

function inferDirection(bound, fieldType, zone) {
  if (bound.dir && bound.dir !== 'CENTER') return;

  if (bound.dir === 'CENTER') {
    // State & Madison - center of grid
    if (fieldType === 'east' || fieldType === 'west') {
      bound.dir = 'WEST';
      bound.num = 0;
    } else {
      bound.dir = 'NORTH';
      bound.num = 0;
    }
    return;
  }

  const wardNum = parseInt(zone.ward);
  const isSouthWard = SOUTH_SIDE_WARDS.has(wardNum);
  const isEastWard = EAST_SIDE_WARDS.has(wardNum);

  // Check if the boundary string contains street-type hints
  const rawStr = (fieldType === 'east' || fieldType === 'west')
    ? (zone.east_block + ' ' + zone.west_block).toLowerCase()
    : (zone.north_boundary + ' ' + zone.south_boundary).toLowerCase();
  const isNumberedStreet = /\d+(st|nd|rd|th)\s+(st|street)/i.test(
    fieldType === 'east' ? zone.east_block :
    fieldType === 'west' ? zone.west_block :
    fieldType === 'north' ? zone.north_boundary :
    zone.south_boundary
  );

  if (fieldType === 'east' || fieldType === 'west') {
    if (isSouthWard && bound.num >= 4000) {
      // South-side ward with large number in E/W column → it's a South address (latitude)
      // e.g., "73rd Street (7100)" in ward 7 = 7100 South
      bound.dir = 'SOUTH';
    } else if (isNumberedStreet && bound.num >= 3000) {
      // Numbered streets (like "73rd St") run E-W → N/S address
      bound.dir = isSouthWard ? 'SOUTH' : 'NORTH';
    } else if (isEastWard && bound.num < 3000) {
      bound.dir = 'EAST';
    } else {
      bound.dir = 'WEST';
    }
  } else {
    // N/S column
    if (isSouthWard && bound.num >= 4000 && !isNumberedStreet) {
      // If it's a south ward and the value looks like it could be a West address
      // (non-numbered street like "Pulaski" in a south ward N/S column)
      bound.dir = 'SOUTH';
    } else if (isSouthWard) {
      bound.dir = 'SOUTH';
    } else if (bound.num >= 3500) {
      bound.dir = 'NORTH';
    } else {
      bound.dir = 'NORTH';
    }

    // Special case: if a non-numbered-street name with a small number appears in
    // N/S column of a south-side ward, it might be East (avenue running N-S)
    if (isSouthWard && bound.num < 3000 && !isNumberedStreet) {
      // Could be an East avenue: "Merrill (2121 E)" ended up without E
      // Check if it makes more sense as East
      if (isEastWard && bound.num > 0 && bound.num < 2800) {
        bound.dir = 'EAST';
      } else if (bound.num < 800) {
        bound.dir = 'EAST';
      } else {
        bound.dir = 'WEST';
      }
    }
  }
}

// ── Upload to Supabase ────────────────────────────────────────────
async function uploadData(zones, scheduleRows, dryRun = false) {
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No data will be uploaded');
    console.log(`   Would upload ${zones.length} zone polygons`);
    console.log(`   Would upload ${scheduleRows.length} schedule rows`);

    // Show sample
    console.log('\n📋 Sample zones:');
    zones.slice(0, 5).forEach(z => {
      console.log(`   Ward ${z.ward} Sec ${z.section}: [${z.westLng.toFixed(4)}, ${z.southLat.toFixed(4)}] to [${z.eastLng.toFixed(4)}, ${z.northLat.toFixed(4)}]`);
    });

    console.log('\n📋 Sample schedule:');
    scheduleRows.slice(0, 5).forEach(r => {
      console.log(`   Ward ${r.ward} Sec ${r.section}: ${r.cleaning_date}`);
    });
    return;
  }

  // ── Step 1: Clear existing 2026 data ────────────────────────────
  console.log('\n🗑️  Clearing existing schedule data...');

  // Delete from TicketlessAmerica
  const { error: deleteScheduleTA } = await taSupabase
    .from('street_cleaning_schedule')
    .delete()
    .neq('ward', 'PLACEHOLDER_NEVER_MATCHES');

  if (deleteScheduleTA && deleteScheduleTA.code !== 'PGRST116') {
    console.error('❌ Error clearing TA schedule:', deleteScheduleTA);
  } else {
    console.log('✅ Cleared TA schedule');
  }

  // ── Step 2: Upload schedule data with boundary info ─────────────
  console.log('\n📤 Uploading schedule data...');

  // Build schedule rows with boundary info from zones
  const zoneByKey = new Map();
  zones.forEach(z => zoneByKey.set(`${z.ward}-${z.section}`, z));

  const enrichedScheduleRows = scheduleRows.map(r => {
    const z = zoneByKey.get(`${r.ward}-${r.section}`);
    return {
      ward: r.ward,
      section: r.section,
      cleaning_date: r.cleaning_date,
      ward_section: `${r.ward}-${r.section}`,
      east_block: z?.east_block || null,
      west_block: z?.west_block || null,
      north_block: z?.north_boundary || null,
      south_block: z?.south_boundary || null,
    };
  });

  // Upload in batches
  const batchSize = 500;
  let insertedSchedule = 0;
  for (let i = 0; i < enrichedScheduleRows.length; i += batchSize) {
    const batch = enrichedScheduleRows.slice(i, i + batchSize);
    const { error } = await taSupabase
      .from('street_cleaning_schedule')
      .insert(batch);
    if (error) {
      console.error(`❌ Schedule batch ${Math.floor(i/batchSize)+1} error:`, error.message);
    } else {
      insertedSchedule += batch.length;
      process.stdout.write(`\r   Progress: ${insertedSchedule}/${enrichedScheduleRows.length}`);
    }
  }
  console.log(`\n✅ Inserted ${insertedSchedule} schedule rows into TA database`);

  // ── Step 3: Generate SQL for zone geometry ──────────────────────
  // PostGIS geometry needs SQL-level insertion. Generate a SQL file
  // that can be run in the Supabase SQL editor.
  console.log('\n📝 Generating zone geometry SQL...');
  const sqlPath = `${__dirname}/zone-geometry-2026.sql`;
  const sqlLines = [
    '-- 2026 Street Cleaning Zone Geometry',
    '-- Run this in the Supabase SQL editor to populate zones table',
    '-- Generated by import-2026-street-cleaning.js',
    '',
    '-- Clear existing zones',
    "DELETE FROM zones WHERE ward IS NOT NULL;",
    '',
    '-- Insert zone polygons',
  ];

  for (const z of zones) {
    const wkt = polygonToWKT(z.polygon);
    const ward = z.ward.replace(/'/g, "''");
    const section = z.section.replace(/'/g, "''");
    sqlLines.push(
      `INSERT INTO zones (ward, section, geom) VALUES ('${ward}', '${section}', ST_SetSRID(ST_GeomFromText('${wkt}'), 4326)) ON CONFLICT (ward, section) DO UPDATE SET geom = ST_SetSRID(ST_GeomFromText('${wkt}'), 4326);`
    );
  }

  sqlLines.push('', `-- ${zones.length} zones inserted`);
  fs.writeFileSync(sqlPath, sqlLines.join('\n'));
  console.log(`✅ Generated ${sqlPath} (${zones.length} zone inserts)`);

  // ── Step 4: Try to upload zones via Supabase RPC ────────────────
  console.log('\n📤 Attempting zone geometry upload via RPC...');
  let insertedZones = 0;

  // Try using the upsert_zone RPC if it exists
  for (const z of zones) {
    try {
      const { error } = await taSupabase.rpc('upsert_zone', {
        p_ward: z.ward,
        p_section: z.section,
        p_geojson: JSON.stringify(z.polygon),
      });
      if (!error) {
        insertedZones++;
      } else if (insertedZones === 0) {
        // RPC doesn't exist, skip remaining
        console.log('⚠️  upsert_zone RPC not found. Run the SQL file manually in Supabase SQL editor.');
        console.log(`   File: ${sqlPath}`);
        break;
      }
    } catch {
      if (insertedZones === 0) {
        console.log('⚠️  upsert_zone RPC not available. Run the SQL file manually.');
        break;
      }
    }
    if (insertedZones % 50 === 0 && insertedZones > 0) {
      process.stdout.write(`\r   Progress: ${insertedZones}/${zones.length}`);
    }
  }
  if (insertedZones > 0) {
    console.log(`\n✅ Inserted ${insertedZones} zone polygons via RPC`);
  }

  // ── Step 5: Upload to MSC database if available ─────────────────
  if (mscSupabase) {
    console.log('\n📤 Uploading schedule to MyStreetCleaning database...');

    await mscSupabase
      .from('street_cleaning_schedule')
      .delete()
      .neq('ward', 'PLACEHOLDER_NEVER_MATCHES');

    let mscInserted = 0;
    for (let i = 0; i < enrichedScheduleRows.length; i += batchSize) {
      const batch = enrichedScheduleRows.slice(i, i + batchSize);
      const { error } = await mscSupabase
        .from('street_cleaning_schedule')
        .insert(batch);
      if (!error) {
        mscInserted += batch.length;
      }
      process.stdout.write(`\r   Progress: ${mscInserted}/${enrichedScheduleRows.length}`);
    }
    console.log(`\n✅ Inserted ${mscInserted} rows into MSC database`);
  }

  // ── Verification ────────────────────────────────────────────────
  console.log('\n🔍 Verifying...');
  const { count: schedCount } = await taSupabase
    .from('street_cleaning_schedule')
    .select('*', { count: 'exact', head: true });
  console.log(`   TA schedule rows: ${schedCount}`);

  const { count: zoneCount } = await taSupabase
    .from('zones')
    .select('*', { count: 'exact', head: true });
  console.log(`   TA zone polygons: ${zoneCount}`);

  if (mscSupabase) {
    const { count: mscCount } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('*', { count: 'exact', head: true });
    console.log(`   MSC schedule rows: ${mscCount}`);
  }
}

function polygonToWKT(polygon) {
  const coords = polygon.coordinates[0];
  const ring = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `POLYGON((${ring}))`;
}

// ── GeoJSON Export (for map component) ────────────────────────────
function exportGeoJSON(zones, outputPath) {
  const features = zones.map(z => ({
    type: 'Feature',
    geometry: z.polygon,
    properties: {
      ward: z.ward,
      section: z.section,
      id: `chi-sc-${z.ward}-${z.section}`,
      east_block: z.east_block,
      west_block: z.west_block,
      north_boundary: z.north_boundary,
      south_boundary: z.south_boundary,
    }
  }));

  const geojson = {
    type: 'FeatureCollection',
    features
  };

  fs.writeFileSync(outputPath, JSON.stringify(geojson));
  console.log(`\n📁 Exported GeoJSON to ${outputPath} (${features.length} features, ${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB)`);
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const csvPath = args[0] || '/home/randy-vollrath/Downloads/2026 Street Cleaning Wards 1-50 - Sheet1.csv';
  const dryRun = flags.includes('--dry-run');
  const exportOnly = flags.includes('--export-only');

  console.log('🚀 2026 Street Cleaning Schedule Import\n');

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  // Parse CSV
  console.log(`📂 Reading CSV: ${csvPath}`);
  const csvRows = parseCSV(csvPath);
  console.log(`📊 Parsed ${csvRows.length} rows`);

  // Build zone data
  const { zones, scheduleRows } = buildZoneData(csvRows);

  // Export GeoJSON (always, for debugging and map fallback)
  const geojsonPath = `${__dirname}/../public/data/street-cleaning-zones-2026.geojson`;
  // Ensure directory exists
  const dataDir = `${__dirname}/../public/data`;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  exportGeoJSON(zones, geojsonPath);

  if (exportOnly) {
    console.log('\n📁 Export-only mode — skipping database upload');
    return;
  }

  // Upload to database
  await uploadData(zones, scheduleRows, dryRun);

  console.log('\n🎉 Import complete!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
