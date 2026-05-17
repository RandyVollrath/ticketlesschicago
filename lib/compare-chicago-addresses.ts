// Compare two Chicago street addresses for the EzBuy address-mismatch guard
// in lib/city-sticker-purchase.ts.
//
// Backstop, not the primary check: our /api/check-permit-zone uses our own
// parking_permit_zones data (updated weekly from Open Data) to decide whether
// a user's saved address falls in a permit zone — and that's what the bot
// trusts when deciding which sticker/permit combo to buy. This helper exists
// only to catch the rarer case where the *city's* record on file in EzBuy is
// stale (e.g. the user updated us but never updated the city). In that case
// EzBuy would happily buy the wrong-zone permit, and the user would be out
// $30 + ticketed for displaying a permit for an address they don't live at.
//
// Failure model: fail-open on parse failure. We never block when we can't
// confidently determine that two addresses differ — false positives here
// would silently break renewals for users with weirdly-formatted addresses.

import { parseChicagoAddress } from './address-parser';

export type CompareResult =
  | { decision: 'match'; reason: string }
  | { decision: 'mismatch'; reason: string; expected: string; found: string }
  | { decision: 'inconclusive'; reason: string };

/**
 * Compare a user's profile address against an address scraped from EzBuy.
 *
 * Returns 'match' when number + direction + street-name + type all agree
 * after normalization, 'mismatch' when they confidently differ, and
 * 'inconclusive' when either input fails to parse — callers MUST treat
 * inconclusive as a non-block (log it; do not stop the renewal).
 */
export function compareChicagoAddresses(expected: string | null | undefined, found: string | null | undefined): CompareResult {
  if (!expected || !found) {
    return { decision: 'inconclusive', reason: 'one or both addresses empty' };
  }

  const a = parseChicagoAddress(expected);
  const b = parseChicagoAddress(found);
  if (!a || !b) {
    return { decision: 'inconclusive', reason: `parse-fail expected=${a ? 'ok' : 'fail'} found=${b ? 'ok' : 'fail'}` };
  }

  if (a.number !== b.number) {
    return { decision: 'mismatch', reason: `street number differs (${a.number} vs ${b.number})`, expected, found };
  }
  if ((a.direction || '') !== (b.direction || '')) {
    // direction missing on one side counts as a mismatch — Chicago grid means
    // "1234 Clark St" is ambiguous between N and S and we shouldn't equate
    // them.
    return { decision: 'mismatch', reason: `direction differs (${a.direction || '∅'} vs ${b.direction || '∅'})`, expected, found };
  }
  if (a.name !== b.name) {
    return { decision: 'mismatch', reason: `street name differs (${a.name} vs ${b.name})`, expected, found };
  }
  // street type is optional; if one side has it and the other doesn't we
  // accept (avoid false positives on "Clark" vs "Clark St").
  if (a.type && b.type && a.type !== b.type) {
    return { decision: 'mismatch', reason: `street type differs (${a.type} vs ${b.type})`, expected, found };
  }

  return { decision: 'match', reason: 'number+direction+name agree' };
}

/**
 * Best-effort scan of page text for Chicago-shaped street addresses.
 * Returns every candidate that looks like a number + direction + name + type,
 * in document order. EzBuy renders the on-file address on the search-results
 * page; without a probed selector we fall back to a regex over the rendered
 * body text and parse each candidate to validate it. Returns [] if none.
 */
export function findChicagoAddressCandidates(pageText: string): string[] {
  if (!pageText) return [];
  // Number + optional direction + 1-3 word street name + optional type suffix.
  // Conservative: requires a recognizable street-type suffix to avoid matching
  // VINs / phone numbers / random number+word pairs.
  const re = /\b(\d{1,5})\s+(N|S|E|W|North|South|East|West)\s+([A-Za-z][A-Za-z .-]{1,40}?)\s+(St|Ave|Blvd|Dr|Rd|Pkwy|Pl|Ct|Ln|Ter|Way|Street|Avenue|Boulevard|Drive|Road|Parkway|Place|Court|Lane|Terrace)\b/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageText)) !== null) {
    const candidate = `${m[1]} ${m[2]} ${m[3].trim()} ${m[4]}`;
    if (parseChicagoAddress(candidate)) out.push(candidate);
  }
  return out;
}
