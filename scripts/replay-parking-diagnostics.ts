#!/usr/bin/env npx tsx
/**
 * Parking Diagnostics Regression Replay — Layer 3 of accuracy measurement system.
 *
 * Reads historical parking_diagnostics rows from Supabase, replays the raw GPS
 * through the CURRENT check-parking algorithm (via localhost or production), and
 * compares old vs new results.
 *
 * Reports:
 *   - How many events changed street
 *   - How many events changed side
 *   - Events where user feedback exists: did accuracy improve or regress?
 *
 * Usage:
 *   npx tsx scripts/replay-parking-diagnostics.ts [--limit 50] [--url http://localhost:3000]
 *
 * Run this BEFORE deploying accuracy changes to check for regressions.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n/g, '') || 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Parse CLI args
const args = process.argv.slice(2);
const limit = parseInt(args[args.indexOf('--limit') + 1] || '50');
const baseUrl = args[args.indexOf('--url') + 1] || 'http://localhost:3000';

interface DiagRow {
  id: number;
  raw_lat: number;
  raw_lng: number;
  raw_accuracy_meters: number | null;
  gps_heading: number | null;
  compass_heading: number | null;
  compass_confidence: number | null;
  resolved_street_name: string | null;
  resolved_street_direction: string | null;
  resolved_house_number: number | null;
  resolved_side: string | null;
  resolved_address: string | null;
  user_confirmed_parking: boolean | null;
  user_confirmed_block: boolean | null;
  user_reported_side: string | null;
  created_at: string;
}

interface ReplayResult {
  diagId: number;
  original: {
    street: string | null;
    direction: string | null;
    side: string | null;
    address: string | null;
  };
  replayed: {
    street: string | null;
    direction: string | null;
    side: string | null;
    address: string | null;
  };
  streetChanged: boolean;
  sideChanged: boolean;
  // If user feedback exists, did we improve?
  userFeedback: {
    confirmedBlock: boolean | null;
    reportedSide: string | null;
  } | null;
  originalCorrect: { street: boolean | null; side: boolean | null };
  replayedCorrect: { street: boolean | null; side: boolean | null };
}

async function replayEvent(row: DiagRow): Promise<ReplayResult | null> {
  // Build the check-parking URL with the original raw GPS
  const params = new URLSearchParams({
    lat: row.raw_lat.toString(),
    lng: row.raw_lng.toString(),
  });
  if (row.raw_accuracy_meters) params.set('accuracy', row.raw_accuracy_meters.toString());
  if (row.gps_heading != null) params.set('heading', row.gps_heading.toString());
  if (row.compass_heading != null) params.set('compass_heading', row.compass_heading.toString());
  if (row.compass_confidence != null) params.set('compass_confidence', row.compass_confidence.toString());

  try {
    // Call the current algorithm — need a valid auth token for the API
    // For replay purposes, we use the service role key as a Bearer token
    const resp = await fetch(`${baseUrl}/api/mobile/check-parking?${params}`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!resp.ok) {
      console.warn(`  [SKIP] HTTP ${resp.status} for diag #${row.id}`);
      return null;
    }

    const data = await resp.json();
    const pa = data.parsedAddress;

    const replayed = {
      street: pa?.name || null,
      direction: pa?.direction || null,
      side: data.locationSnap?.resolvedSide || null, // May not be in response
      address: data.address || null,
    };

    const original = {
      street: row.resolved_street_name,
      direction: row.resolved_street_direction,
      side: row.resolved_side,
      address: row.resolved_address,
    };

    const streetChanged = replayed.street !== original.street;
    const sideChanged = replayed.side !== original.side && original.side != null && replayed.side != null;

    // Check against user feedback if available
    let userFeedback = null;
    let originalCorrect: { street: boolean | null; side: boolean | null } = { street: null, side: null };
    let replayedCorrect: { street: boolean | null; side: boolean | null } = { street: null, side: null };

    if (row.user_confirmed_block !== null || row.user_reported_side !== null) {
      userFeedback = {
        confirmedBlock: row.user_confirmed_block,
        reportedSide: row.user_reported_side,
      };

      if (row.user_confirmed_block !== null) {
        originalCorrect.street = row.user_confirmed_block;
        // If original was correct and replayed changed the street, replayed is wrong
        // If original was wrong and replayed changed the street, replayed MIGHT be right
        replayedCorrect.street = streetChanged ? !row.user_confirmed_block : row.user_confirmed_block;
      }

      if (row.user_reported_side) {
        originalCorrect.side = original.side === row.user_reported_side;
        replayedCorrect.side = replayed.side === row.user_reported_side;
      }
    }

    return {
      diagId: row.id,
      original,
      replayed,
      streetChanged,
      sideChanged,
      userFeedback,
      originalCorrect,
      replayedCorrect,
    };
  } catch (err) {
    console.warn(`  [ERROR] Replay failed for diag #${row.id}:`, err);
    return null;
  }
}

async function main() {
  console.log(`\n=== Parking Diagnostics Regression Replay ===`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Limit: ${limit} events\n`);

  // Fetch diagnostic rows
  const { data: rows, error } = await supabase
    .from('parking_diagnostics')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch diagnostics:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No diagnostic rows found. Park a few times first!');
    process.exit(0);
  }

  console.log(`Loaded ${rows.length} diagnostic events. Replaying...\n`);

  const results: ReplayResult[] = [];
  for (const row of rows as DiagRow[]) {
    process.stdout.write(`  Replaying #${row.id} (${row.resolved_address || 'no address'})...`);
    const result = await replayEvent(row);
    if (result) {
      results.push(result);
      const flags = [
        result.streetChanged ? 'STREET CHANGED' : '',
        result.sideChanged ? 'SIDE CHANGED' : '',
      ].filter(Boolean).join(', ');
      console.log(flags || 'OK');
    } else {
      console.log('SKIPPED');
    }
  }

  // Summary
  console.log(`\n=== RESULTS ===`);
  console.log(`Total replayed: ${results.length}`);
  console.log(`Street changed: ${results.filter(r => r.streetChanged).length}`);
  console.log(`Side changed: ${results.filter(r => r.sideChanged).length}`);

  // Detailed changes
  const streetChanges = results.filter(r => r.streetChanged);
  if (streetChanges.length > 0) {
    console.log(`\n--- Street Changes ---`);
    for (const r of streetChanges) {
      const fb = r.userFeedback?.confirmedBlock;
      const label = fb === true ? ' [user: CORRECT]' : fb === false ? ' [user: WRONG]' : '';
      console.log(`  #${r.diagId}: ${r.original.direction} ${r.original.street} → ${r.replayed.direction} ${r.replayed.street}${label}`);
      if (r.userFeedback) {
        const was = r.originalCorrect.street ? 'correct' : 'wrong';
        const now = r.replayedCorrect.street ? 'correct' : 'wrong';
        console.log(`    Accuracy: ${was} → ${now} ${was !== now ? (now === 'correct' ? '(IMPROVED)' : '(REGRESSED!)') : '(unchanged)'}`);
      }
    }
  }

  const sideChanges = results.filter(r => r.sideChanged);
  if (sideChanges.length > 0) {
    console.log(`\n--- Side Changes ---`);
    for (const r of sideChanges) {
      const fb = r.userFeedback?.reportedSide;
      const label = fb ? ` [user: ${fb}]` : '';
      console.log(`  #${r.diagId}: ${r.original.side} → ${r.replayed.side}${label}`);
      if (r.userFeedback?.reportedSide) {
        const was = r.originalCorrect.side ? 'correct' : 'wrong';
        const now = r.replayedCorrect.side ? 'correct' : 'wrong';
        console.log(`    Accuracy: ${was} → ${now} ${was !== now ? (now === 'correct' ? '(IMPROVED)' : '(REGRESSED!)') : '(unchanged)'}`);
      }
    }
  }

  // Events with user feedback — accuracy summary
  const withFeedback = results.filter(r => r.userFeedback);
  if (withFeedback.length > 0) {
    console.log(`\n--- Accuracy vs User Feedback (${withFeedback.length} events) ---`);
    const streetImproved = withFeedback.filter(r => r.originalCorrect.street === false && r.replayedCorrect.street === true).length;
    const streetRegressed = withFeedback.filter(r => r.originalCorrect.street === true && r.replayedCorrect.street === false).length;
    const sideImproved = withFeedback.filter(r => r.originalCorrect.side === false && r.replayedCorrect.side === true).length;
    const sideRegressed = withFeedback.filter(r => r.originalCorrect.side === true && r.replayedCorrect.side === false).length;

    console.log(`  Street: ${streetImproved} improved, ${streetRegressed} regressed`);
    console.log(`  Side: ${sideImproved} improved, ${sideRegressed} regressed`);

    if (streetRegressed > 0 || sideRegressed > 0) {
      console.log(`\n  ⚠️  REGRESSIONS DETECTED — review changes before deploying!`);
    } else if (streetImproved > 0 || sideImproved > 0) {
      console.log(`\n  ✅  Accuracy improved with no regressions!`);
    } else {
      console.log(`\n  ℹ️  No accuracy change for events with feedback.`);
    }
  } else {
    console.log(`\nNo events with user feedback yet. Use the app's feedback card to build ground truth.`);
  }
}

main().catch(console.error);
