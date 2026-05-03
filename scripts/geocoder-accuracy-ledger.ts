#!/usr/bin/env npx tsx
/**
 * Geocoder accuracy ledger.
 *
 * For every user correction or confirmation event, this finds the matching
 * parking_diagnostics row (by user_id + nearest event_ts within a window),
 * extracts what each tool said (PostGIS snap, Nominatim, Apple Maps,
 * Mapbox), and asks: which tool's answer matched the user's
 * corrected/confirmed street?
 *
 * Then aggregates per-tool over the window and reports match rates so we
 * can re-tune the override heuristics in check-parking.ts data-driven,
 * not by anecdote.
 *
 * Usage:
 *   node -r dotenv/config node_modules/.bin/tsx \
 *     scripts/geocoder-accuracy-ledger.ts dotenv_config_path=.env.local
 *
 * Or specify a window:
 *   --since 30d   (default)
 *   --since 7d
 *   --since 2026-04-01
 */

import { createClient } from '@supabase/supabase-js';

interface ToolStats {
  total: number;
  matched: number;
  available: number;   // how often the tool produced any answer at all
}

const TOOLS = ['snap', 'nominatim', 'apple', 'mapbox'] as const;
type ToolName = (typeof TOOLS)[number];

function normStreet(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/^\s*(north|south|east|west|n|s|e|w)\s+/, '')
    .replace(/\s+(ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane|pkwy|parkway|hwy|highway|ter|terrace|way|cir|circle)\.?\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseSinceArg(): Date {
  const idx = process.argv.indexOf('--since');
  if (idx === -1) return new Date(Date.now() - 30 * 86400 * 1000);
  const v = process.argv[idx + 1] || '30d';
  const m = v.match(/^(\d+)d$/);
  if (m) return new Date(Date.now() - Number(m[1]) * 86400 * 1000);
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;
  console.error(`Bad --since arg: ${v}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const since = parseSinceArg();
  console.log(`→ Geocoder accuracy ledger (since ${since.toISOString()})\n`);

  // Pull every correction event in the window. We only score against
  // events where the user told us the right answer — confirmations don't
  // tell us much (the snap was probably already right).
  const { data: corrections, error: cErr } = await (supabase as any)
    .from('mobile_ground_truth_events')
    .select('user_id, event_ts, latitude, longitude, metadata, event_type')
    .eq('event_type', 'parking_street_correction')
    .gte('event_ts', since.toISOString())
    .order('event_ts', { ascending: false })
    .limit(500);
  if (cErr) {
    console.error(`Query corrections failed: ${cErr.message}`);
    if (cErr.message?.includes('mobile_ground_truth_events')) {
      console.error('→ Did you apply the migration? supabase/migrations/20260430_create_mobile_ground_truth_events.sql');
    }
    process.exit(1);
  }
  if (!corrections || corrections.length === 0) {
    console.log('No corrections in window. Cannot score.');
    process.exit(0);
  }

  console.log(`Found ${corrections.length} correction event${corrections.length === 1 ? '' : 's'}.\n`);

  const stats: Record<ToolName, ToolStats> = {
    snap: { total: 0, matched: 0, available: 0 },
    nominatim: { total: 0, matched: 0, available: 0 },
    apple: { total: 0, matched: 0, available: 0 },
    mapbox: { total: 0, matched: 0, available: 0 },
  };

  let unmatched = 0;
  const examples: Array<{ ts: string; corrected: string; perTool: Record<ToolName, string | null> }> = [];

  for (const c of corrections) {
    const correctedAddress = (c.metadata as any)?.corrected_address as string | undefined;
    if (!correctedAddress) { unmatched++; continue; }
    const correctedStreet = normStreet(correctedAddress.split(',')[0].replace(/^\d+\s+/, ''));
    if (!correctedStreet) { unmatched++; continue; }

    // Find the parking_diagnostics row closest to this event in time, for
    // the same user. Window: 5 minutes before/after the correction event.
    const eventTs = new Date(c.event_ts).getTime();
    const { data: diagRows } = await supabase
      .from('parking_diagnostics')
      .select('created_at, snap_street_name, nominatim_street, native_meta, resolved_street_name')
      .eq('user_id', c.user_id)
      .gte('created_at', new Date(eventTs - 5 * 60 * 1000).toISOString())
      .lte('created_at', new Date(eventTs + 5 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });
    if (!diagRows || diagRows.length === 0) { unmatched++; continue; }

    // Pick the diag closest in time.
    const diag = diagRows.reduce((best: any, row: any) => {
      const dBest = Math.abs(new Date(best.created_at).getTime() - eventTs);
      const dRow = Math.abs(new Date(row.created_at).getTime() - eventTs);
      return dRow < dBest ? row : best;
    });

    const native: any = diag.native_meta || {};
    const perTool: Record<ToolName, string | null> = {
      snap: diag.snap_street_name || null,
      nominatim: diag.nominatim_street || null,
      apple: native?.apple?.thoroughfare || native?.apple?.name || null,
      mapbox: native?.mapbox_reverse?.street || native?.mapbox?.street || null,
    };

    for (const tool of TOOLS) {
      stats[tool].total++;
      const v = perTool[tool];
      if (!v) continue;
      stats[tool].available++;
      if (normStreet(v) === correctedStreet) stats[tool].matched++;
    }

    if (examples.length < 5) {
      examples.push({ ts: c.event_ts, corrected: correctedAddress, perTool });
    }
  }

  console.log('Per-tool match rate (against user-corrected ground truth):\n');
  console.log('  Tool       Available   Match   Rate (when available)');
  for (const tool of TOOLS) {
    const s = stats[tool];
    const availPct = s.total ? (s.available / s.total * 100).toFixed(0) : '0';
    const matchRate = s.available ? (s.matched / s.available * 100).toFixed(1) : 'n/a';
    console.log(
      `  ${tool.padEnd(11)} ${(s.available + '/' + s.total).padEnd(10)} ${(s.matched + '/' + s.available).padEnd(7)} ${matchRate}%${'  '}` +
      (availPct === '0' ? '(no data)' : `(available ${availPct}% of the time)`)
    );
  }
  console.log(`  unmatched ${unmatched} correction${unmatched === 1 ? '' : 's'} had no nearby parking_diagnostics or no corrected_address`);

  if (examples.length > 0) {
    console.log('\nExamples:');
    for (const ex of examples) {
      console.log(`  ${ex.ts} corrected → ${ex.corrected}`);
      for (const tool of TOOLS) {
        const v = ex.perTool[tool];
        const got = v ? `"${v}"` : '(none)';
        const ok = v && normStreet(v) === normStreet(ex.corrected.split(',')[0].replace(/^\d+\s+/, '')) ? '✓' : '✗';
        console.log(`    ${tool.padEnd(11)} ${ok} ${got}`);
      }
    }
  }

  console.log('\nUse this to re-weight the override logic in pages/api/mobile/check-parking.ts.');
  console.log('Higher match rate (when available) = trust the tool more in tie-breaks.');
}

main().catch(err => {
  console.error('Ledger crashed:', err);
  process.exit(1);
});
