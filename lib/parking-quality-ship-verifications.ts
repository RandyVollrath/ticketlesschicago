/**
 * Ship verification — runs as part of the 2x daily parking-quality cron.
 *
 * For each recent code change that can be server-verified via
 * parking_diagnostics, we add a ShipDefinition here. The cron runs every
 * definition's verify() against the last window, classifies the result
 * (working / degraded / unclear / no_signal), and surfaces it in the
 * digest email so regressions don't go unnoticed.
 *
 * Adding a new verification:
 *   1. Append a ShipDefinition to SHIP_DEFINITIONS.
 *   2. Write verify(rows) that returns a ShipVerification. Use the shared
 *      rows array — don't re-query Supabase unless you need a different
 *      table or a wider window.
 *   3. Pick conservative thresholds. "unclear" is better than "degraded"
 *      on low sample counts — we'd rather not wake the founder.
 *
 * Retiring an old verification:
 *   Once a fix has consistently been 'working' for 30+ days, remove its
 *   definition. Keep the list focused on recent ships that could regress.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ShipVerdict = 'working' | 'degraded' | 'unclear' | 'no_signal';

export interface ShipVerification {
  name: string;
  commit: string;
  shipped_at: string; // YYYY-MM-DD
  verdict: ShipVerdict;
  summary: string;
  details: Record<string, any>;
}

interface DiagnosticRow {
  id: number;
  created_at: string;
  snap_source: string | null;
  nominatim_overrode: boolean | null;
  native_meta: any;
}

interface ShipDefinition {
  name: string;
  commit: string;
  shipped_at: string;
  verify: (rows: DiagnosticRow[]) => ShipVerification;
}

const OVERRIDE_SOURCES = new Set([
  'nominatim_override',
  'nominatim_override_candidate_match',
  'nominatim_override_extended',
  'mapbox_match_candidate',
]);

function verifyMapboxRadius(rows: DiagnosticRow[]): ShipVerification {
  const meta = {
    name: 'Mapbox radius bump 5m → 25m',
    commit: 'c03a9926',
    shipped_at: '2026-04-24',
  };

  const mapboxRows = rows.filter((r) => r.native_meta?.mapbox_reverse || r.native_meta?.mapbox);
  if (mapboxRows.length < 3) {
    return {
      ...meta,
      verdict: 'no_signal',
      summary: `Only ${mapboxRows.length} Mapbox calls in window — too few to tell.`,
      details: { total_mapbox_calls: mapboxRows.length },
    };
  }

  const confidenceScore = (r: DiagnosticRow): number => {
    const revConfidence = r.native_meta?.mapbox_reverse?.match_confidence;
    if (typeof revConfidence === 'string') {
      if (revConfidence === 'exact') return 1;
      if (revConfidence === 'high') return 0.85;
      if (revConfidence === 'medium') return 0.6;
      if (revConfidence === 'low') return 0.25;
    }
    return typeof r.native_meta?.mapbox?.confidence === 'number'
      ? r.native_meta.mapbox.confidence
      : 0;
  };
  const streetValue = (r: DiagnosticRow): string | null =>
    r.native_meta?.mapbox_reverse?.street ?? r.native_meta?.mapbox?.street ?? null;
  const matchedValue = (r: DiagnosticRow): boolean =>
    Boolean(r.native_meta?.mapbox_reverse?.matched ?? r.native_meta?.mapbox?.matched);
  const promotedValue = (r: DiagnosticRow): boolean =>
    Boolean(r.native_meta?.mapbox_reverse?.confirmed_nominatim_override ?? r.native_meta?.mapbox?.promoted);

  const matched = mapboxRows.filter((r) => matchedValue(r)).length;
  const emptyStreet = mapboxRows.filter(
    (r) => matchedValue(r) && !streetValue(r),
  ).length;
  // Cross-source agreement is the strongest practical confidence signal
  // for v6 reverse-geocode because match_code.confidence is null for
  // non-building points (the typical parking case). When Mapbox-reverse
  // matches AND agrees with both snap and Nominatim, three independent
  // geocoders concur — that's strictly stronger than match_code='medium'.
  const crossSourceAgrees = (r: DiagnosticRow): boolean => {
    const rev = r.native_meta?.mapbox_reverse;
    if (!rev) return false;
    return rev.matched === true && rev.agrees_with_snap === true && rev.agrees_with_nominatim === true;
  };
  const confidentMatches = mapboxRows.filter(
    (r) => confidenceScore(r) >= 0.5 || crossSourceAgrees(r),
  ).length;
  const promoted = mapboxRows.filter((r) => promotedValue(r)).length;
  const noMatch = mapboxRows.filter((r) => !matchedValue(r)).length;
  const reverseRows = mapboxRows.filter((r) => r.native_meta?.mapbox_reverse).length;
  const mapMatchRows = mapboxRows.filter((r) => r.native_meta?.mapbox).length;

  const pctEmpty = (emptyStreet / mapboxRows.length) * 100;
  const pctConfident = (confidentMatches / mapboxRows.length) * 100;

  // Before fix (2026-04-24 baseline): 100% empty street + 0% confidence on
  // matched rows, 0 promoted. After fix, radius reaches the real street so
  // we expect real names + higher confidence.
  let verdict: ShipVerdict;
  let summary: string;
  if (pctEmpty < 25 && pctConfident >= 25) {
    verdict = 'working';
    summary = `Mapbox returning real results — ${pctConfident.toFixed(0)}% with confidence ≥ 0.5, ${promoted} confirmed/promoted (${pctEmpty.toFixed(0)}% empty street).`;
  } else if (pctEmpty > 60 || pctConfident < 10) {
    verdict = 'degraded';
    summary = `Mapbox still mostly unusable — ${pctEmpty.toFixed(0)}% empty street, only ${pctConfident.toFixed(0)}% confident. Radius bump may not be enough.`;
  } else {
    verdict = 'unclear';
    summary = `Partial improvement — ${pctEmpty.toFixed(0)}% empty, ${pctConfident.toFixed(0)}% confident, ${promoted} confirmed/promoted.`;
  }

  return {
    ...meta,
    verdict,
    summary,
    details: {
      total_mapbox_calls: mapboxRows.length,
      matched,
      no_match: noMatch,
      empty_street: emptyStreet,
      confident_matches: confidentMatches,
      promoted,
      reverse_rows: reverseRows,
      map_match_rows: mapMatchRows,
      pct_empty: round1(pctEmpty),
      pct_confident: round1(pctConfident),
    },
  };
}

function verifyOverrideInterpolation(rows: DiagnosticRow[]): ShipVerification {
  const meta = {
    name: 'Address interpolation after Nominatim/Mapbox override',
    commit: 'c03a9926',
    shipped_at: '2026-04-24',
  };

  const overrideRows = rows.filter((r) => r.snap_source && OVERRIDE_SOURCES.has(r.snap_source));
  if (overrideRows.length < 3) {
    return {
      ...meta,
      verdict: 'no_signal',
      summary: `Only ${overrideRows.length} override rows in window — too few to tell.`,
      details: { override_rows: overrideRows.length },
    };
  }

  const fallback = overrideRows.filter(
    (r) => r.native_meta?.address_number_source === 'fallback',
  ).length;
  const interpolated = overrideRows.filter(
    (r) => r.native_meta?.address_number_source === 'segment_interpolation',
  ).length;
  const buildingFootprint = overrideRows.filter(
    (r) => r.native_meta?.address_number_source === 'building_footprint',
  ).length;
  const pctFallback = (fallback / overrideRows.length) * 100;
  const pctGood = ((interpolated + buildingFootprint) / overrideRows.length) * 100;

  // Before fix: 100% of override rows fell through to 'fallback' (raw
  // reverse-geocode → block-start house number). After fix: should be
  // mostly 'segment_interpolation' or 'building_footprint'.
  let verdict: ShipVerdict;
  let summary: string;
  if (pctFallback < 15) {
    verdict = 'working';
    summary = `Override paths now interpolate — ${pctGood.toFixed(0)}% from segment/building, only ${pctFallback.toFixed(0)}% fallback.`;
  } else if (pctFallback > 50) {
    verdict = 'degraded';
    summary = `Override paths still falling through — ${pctFallback.toFixed(0)}% fallback (${fallback}/${overrideRows.length}). Helper may not be firing.`;
  } else {
    verdict = 'unclear';
    summary = `Partial adoption — ${pctFallback.toFixed(0)}% fallback, ${interpolated} interpolated, ${buildingFootprint} building-footprint.`;
  }

  return {
    ...meta,
    verdict,
    summary,
    details: {
      override_rows: overrideRows.length,
      fallback,
      interpolated,
      building_footprint: buildingFootprint,
      pct_fallback: round1(pctFallback),
      pct_good: round1(pctGood),
      by_source: Object.fromEntries(
        Array.from(OVERRIDE_SOURCES).map((src) => [
          src,
          overrideRows.filter((r) => r.snap_source === src).length,
        ]),
      ),
    },
  };
}

const SHIP_DEFINITIONS: ShipDefinition[] = [
  {
    name: 'Mapbox radius bump 5m → 25m',
    commit: 'c03a9926',
    shipped_at: '2026-04-24',
    verify: verifyMapboxRadius,
  },
  {
    name: 'Address interpolation after Nominatim/Mapbox override',
    commit: 'c03a9926',
    shipped_at: '2026-04-24',
    verify: verifyOverrideInterpolation,
  },
];

export async function verifyRecentShips(
  supabaseAdmin: SupabaseClient,
  windowStart: string,
  windowEnd: string,
): Promise<ShipVerification[]> {
  if (SHIP_DEFINITIONS.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('parking_diagnostics')
    .select('id, created_at, snap_source, nominatim_overrode, native_meta')
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd);

  if (error) {
    console.error('verifyRecentShips query failed:', error.message);
    return SHIP_DEFINITIONS.map((d) => ({
      name: d.name,
      commit: d.commit,
      shipped_at: d.shipped_at,
      verdict: 'no_signal' as const,
      summary: `Query failed: ${error.message}`,
      details: {},
    }));
  }

  const rows = (data ?? []) as DiagnosticRow[];
  return SHIP_DEFINITIONS.map((def) => def.verify(rows));
}

export function renderVerificationsHtml(verifications: ShipVerification[]): string {
  if (verifications.length === 0) return '';
  const verdictColor: Record<ShipVerdict, string> = {
    working: '#059669',
    degraded: '#dc2626',
    unclear: '#d97706',
    no_signal: '#6b7280',
  };
  const verdictLabel: Record<ShipVerdict, string> = {
    working: '✓ WORKING',
    degraded: '✗ DEGRADED',
    unclear: '~ UNCLEAR',
    no_signal: '· NO SIGNAL',
  };
  const rows = verifications
    .map(
      (v) => `
      <div style="border-left: 4px solid ${verdictColor[v.verdict]}; padding: 10px 14px; margin: 10px 0; background: #f8fafc;">
        <div style="font-weight: 600; color: ${verdictColor[v.verdict]};">${verdictLabel[v.verdict]} — ${escapeHtml(v.name)}</div>
        <div style="font-size: 13px; color: #374151; margin-top: 4px;">${escapeHtml(v.summary)}</div>
        <div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">
          shipped ${v.shipped_at} · <code>${v.commit}</code> ·
          <code>${escapeHtml(JSON.stringify(v.details))}</code>
        </div>
      </div>
    `,
    )
    .join('');
  return `
    <h3 style="margin-top: 24px; color: #0f172a;">Recent ship verification</h3>
    ${rows}
  `;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
