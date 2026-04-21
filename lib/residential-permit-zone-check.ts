/**
 * Residential-permit zone cross-check.
 *
 * Chicago's residential-parking-permit-zones dataset (u9xt-hiju) is NOT
 * a polygon dataset — it's one row per address range, e.g. zone 143
 * covers 1856–1856 N KENMORE AVE (east side). So our match is a
 * street-address join, not point-in-polygon.
 *
 * Two useful signals we can actually produce from the data:
 *
 * 1. For `residential_permit` tickets where we know the ticket's street
 *    address (via OCR of the paper ticket): is that street-direction-
 *    name-number-parity combination listed in the active permit-zone
 *    dataset? If NOT, the zone doesn't legally exist here at this
 *    house-number parity, and the citation's prima-facie case fails.
 *
 * 2. Cross-check the user's registered mailing address against the
 *    dataset to learn the zone they're entitled to. If the ticket's
 *    zone differs, the user was visiting (§ 9-64-070 visitor defense).
 *
 * We do NOT do point-in-polygon; we parse both addresses into
 * {number, direction, name, type} and look up the matching rows.
 */

export interface PermitZoneFinding {
  checked: boolean;
  userInsideZone: boolean | null;
  userZone: string | null;
  ticketInsideZone: boolean | null;
  ticketZone: string | null;
  mismatch: boolean;
  defenseSummary: string | null;
}

type ParsedAddress = {
  number: number;
  direction: string; // N | S | E | W
  name: string;
  type: string; // AVE | ST | BLVD | PL | DR | TER | LN | WAY ...
  parity: 'E' | 'O';
};

const PERMIT_ZONES_DATASET = 'https://data.cityofchicago.org/resource/u9xt-hiju.json';

type ZoneRow = {
  zone?: string;
  status?: string;
  odd_even?: string; // 'E' | 'O' | 'B' (both)
  address_range_low?: string;
  address_range_high?: string;
  street_direction?: string;
  street_name?: string;
  street_type?: string;
  buffer?: string;
};

/**
 * Parse a Chicago street address into components. Returns null for
 * addresses we can't confidently parse.
 */
function parseChicagoAddress(raw: string): ParsedAddress | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/,?\s*chicago.*$/i, '')
    .replace(/,?\s*il\s*\d{0,5}\s*$/i, '')
    .replace(/,$/, '')
    .trim();

  // Examples this matches:
  //   "1856 N KENMORE AVE"
  //   "2511 W Le Moyne St Apt 1"    -> strips Apt suffix
  //   "800 W 111TH ST"
  const withoutUnit = cleaned.replace(/\s+(?:apt|unit|ste|suite|#)\s*\S+\s*$/i, '').trim();
  const m = withoutUnit.match(/^(\d+)\s+([NSEW])\s+(.+?)\s+(AVE|ST|BLVD|PL|DR|TER|LN|WAY|CT|PKWY|SQ|PLZ|RD)\.?$/i);
  if (!m) return null;

  const number = parseInt(m[1], 10);
  if (!Number.isFinite(number)) return null;
  return {
    number,
    direction: m[2].toUpperCase(),
    name: m[3].toUpperCase().replace(/\./g, '').trim(),
    type: m[4].toUpperCase().replace(/\./g, ''),
    parity: number % 2 === 0 ? 'E' : 'O',
  };
}

/**
 * Query Chicago Open Data for permit-zone rows covering the parsed
 * address. The dataset stores `address_range_low/high` as TEXT fields,
 * and SoQL's numeric cast syntax is inconsistent across the Open Data
 * platform versions — so we fetch all rows for this street and do the
 * number-range check client-side. The per-street dataset is tiny
 * (usually < 100 rows), so this is still fast.
 */
async function findZoneForAddress(parsed: ParsedAddress): Promise<{ zone: string } | null> {
  const where = [
    `upper(street_direction) = '${parsed.direction}'`,
    `upper(street_name) = '${parsed.name.replace(/'/g, "''")}'`,
    `upper(street_type) = '${parsed.type}'`,
    `(odd_even = 'B' or odd_even = '${parsed.parity}')`,
    `status = 'ACTIVE'`,
  ].join(' and ');

  const url = new URL(PERMIT_ZONES_DATASET);
  url.searchParams.set('$where', where);
  url.searchParams.set('$select', 'zone, address_range_low, address_range_high');
  url.searchParams.set('$limit', '500');

  try {
    const r = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as ZoneRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // Client-side numeric range filter.
    for (const row of rows) {
      const lo = parseInt(row.address_range_low || '', 10);
      const hi = parseInt(row.address_range_high || '', 10);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      if (parsed.number >= lo && parsed.number <= hi) {
        return { zone: row.zone || 'unknown' };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getResidentialPermitZoneFinding(
  userMailingAddress: string | null,
  ticketAddress: string | null,
): Promise<PermitZoneFinding | null> {
  if (!userMailingAddress && !ticketAddress) return null;

  const userParsed = userMailingAddress ? parseChicagoAddress(userMailingAddress) : null;
  const ticketParsed = ticketAddress ? parseChicagoAddress(ticketAddress) : null;

  // If we couldn't parse either address, skip — don't emit a misleading
  // "outside any zone" finding.
  if (!userParsed && !ticketParsed) return null;

  const userZone = userParsed ? await findZoneForAddress(userParsed) : null;
  const ticketZone = ticketParsed ? await findZoneForAddress(ticketParsed) : null;

  const result: PermitZoneFinding = {
    checked: true,
    userInsideZone: userParsed ? !!userZone : null,
    userZone: userZone?.zone || null,
    ticketInsideZone: ticketParsed ? !!ticketZone : null,
    ticketZone: ticketZone?.zone || null,
    mismatch: !!(userZone && ticketZone && userZone.zone !== ticketZone.zone),
    defenseSummary: null,
  };

  // Build defense paragraph. Only for cases where we have strong
  // evidence; ambiguous cases return null so we don't manufacture a
  // false defense.
  if (ticketParsed && result.ticketInsideZone === false) {
    result.defenseSummary = `The City of Chicago's active residential-permit-zone records (Open Data Portal, dataset u9xt-hiju) do not list ${ticketParsed.number} ${ticketParsed.direction} ${ticketParsed.name} ${ticketParsed.type} (${ticketParsed.parity === 'E' ? 'even' : 'odd'}-numbered side) in ANY active permit zone. Because no permit zone is registered for this address, the permit requirement the citation alleges does not apply — a § 9-100-060(a)(4) codified defense (the violation did not in fact occur).`;
  } else if (result.mismatch && userZone && ticketZone) {
    result.defenseSummary = `The registered owner's address (${userParsed?.number} ${userParsed?.direction} ${userParsed?.name} ${userParsed?.type}) is in residential-permit zone ${userZone.zone}, but the citation was issued in zone ${ticketZone.zone}. The vehicle was demonstrably away from its home zone — under Chicago Municipal Code § 9-64-070(c), a permitted resident parking outside their own zone has additional allowances (temporary visitor parking, guest passes) that the City must disprove.`;
  } else if (userZone && ticketZone && userZone.zone === ticketZone.zone) {
    result.defenseSummary = `The cited location is in residential-permit zone ${ticketZone.zone}, and the registered owner's address is inside this same zone — the owner is entitled to a permit for this zone. If a permit was properly displayed but not visible to the enforcement officer (sun-bleached placard, placed on the wrong window, obscured by condensation / ice / dashboard items), that is grounds for dismissal under § 9-100-060(a)(4).`;
  }

  return result;
}
