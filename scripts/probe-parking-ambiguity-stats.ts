#!/usr/bin/env npx tsx
/**
 * Answers Randy's three diagnostic questions, with real numbers:
 *
 *   Q1. How often does the pipeline have 2+ genuinely competitive candidate
 *       STREETS at parking time (i.e. would we know to prompt 2-3 options)?
 *   Q2. How often would those competing candidates BE the right answer
 *       (i.e. user-flagged street_correct=false rows)?
 *   Q3. How often does block-level ambiguity exist on the SAME street name
 *       (the "wrong block of Wolcott" case)?
 *
 * Definitions:
 *   - "competitive" = candidate #2 within 1.5x the distance of candidate #1,
 *                     AND candidate #2 is itself within 50m of raw GPS.
 *   - "block ambiguity" = same street name has 2+ centerline segments within
 *                         search radius (NOT visible to current snap RPC).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: usersList } = await s.auth.admin.listUsers({ perPage: 1000 });
  const user = (usersList?.users || []).find(u => u.email === 'randyvollrath@gmail.com');
  if (!user) { console.error('user not found'); process.exit(1); }

  // Pull the last 200 events for Randy.
  const { data: rows } = await s
    .from('parking_diagnostics')
    .select('id, created_at, raw_lat, raw_lng, resolved_address, snap_street_name, snap_distance_meters, address_confidence, near_intersection, user_feedback_at, street_correct')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (!rows?.length) { console.log('No rows'); return; }
  console.log(`Analyzing ${rows.length} most recent parking events for randyvollrath@gmail.com\n`);

  let totalAnalyzed = 0;
  let competitive2Streets = 0;
  let competitive3PlusStreets = 0;
  let blockAmbiguity = 0;
  let competitiveAndUserSaidWrong = 0;
  let competitiveButUserConfirmed = 0;
  const examplesCompetitive: any[] = [];
  const examplesBlock: any[] = [];

  for (const r of rows) {
    if (typeof r.raw_lat !== 'number' || typeof r.raw_lng !== 'number') continue;
    totalAnalyzed++;

    // Q1+Q2: cross-street ambiguity
    const { data: snap } = await s.rpc('snap_to_nearest_street', {
      user_lat: r.raw_lat, user_lng: r.raw_lng, search_radius_meters: 80,
    });
    const cands = (snap || []).filter((c: any) => c.was_snapped);
    let isCompetitive = false;
    if (cands.length >= 2) {
      const d1 = cands[0].snap_distance_meters;
      const d2 = cands[1].snap_distance_meters;
      if (d2 < 50 && d2 < d1 * 1.5 + 5) {
        isCompetitive = true;
        competitive2Streets++;
        if (cands.length >= 3) {
          const d3 = cands[2].snap_distance_meters;
          if (d3 < 50 && d3 < d1 * 1.7 + 5) competitive3PlusStreets++;
        }
        if (examplesCompetitive.length < 8) {
          examplesCompetitive.push({
            when: r.created_at,
            resolved: r.resolved_address,
            cands: cands.slice(0, 3).map((c: any) => `${c.street_name} (${c.snap_distance_meters.toFixed(1)}m)`),
            userFb: r.user_feedback_at ? (r.street_correct ? 'CORRECT' : 'WRONG') : null,
          });
        }
      }
    }
    if (isCompetitive && r.user_feedback_at) {
      if (r.street_correct === false) competitiveAndUserSaidWrong++;
      else if (r.street_correct === true) competitiveButUserConfirmed++;
    }

    // Q3: block-level ambiguity on the SAME street.
    // Direct query of street_centerlines: how many segments share the
    // resolved street name and are within 80m?
    if (r.snap_street_name) {
      const { data: segs } = await s
        .from('street_centerlines')
        .select('l_from_addr, l_to_addr')
        .eq('street_name', r.snap_street_name)
        .filter('geom', 'not.is', null);
      // Without PostGIS in the JS query, just count segments by addr range
      // overlap as a proxy. Better: a custom RPC. Skip the precise version.
      // We DO know: snap RPC returned only ONE row for this name → it's a
      // potential block-ambiguity case if there's >1 segment in the table
      // for this name AND the address ranges differ from what we resolved.
      // Quick heuristic: count distinct address ranges.
      if (segs && segs.length >= 2) {
        const ranges = new Set(segs.map(s => `${s.l_from_addr}-${s.l_to_addr}`));
        if (ranges.size >= 2) {
          // This counts streets that have multiple blocks anywhere.
          // To localize, we'd need PostGIS. Mark for example only.
          if (examplesBlock.length < 5) {
            examplesBlock.push({
              when: r.created_at,
              resolved: r.resolved_address,
              streetSegmentCount: segs.length,
              uniqueRanges: ranges.size,
            });
          }
        }
      }
    }
  }

  console.log('═══ Q1: Cross-street candidate competitiveness ═══');
  console.log(`Events analyzed: ${totalAnalyzed}`);
  console.log(`Events with 2+ competitive candidates: ${competitive2Streets} (${(100*competitive2Streets/totalAnalyzed).toFixed(1)}%)`);
  console.log(`Events with 3+ competitive candidates: ${competitive3PlusStreets} (${(100*competitive3PlusStreets/totalAnalyzed).toFixed(1)}%)`);
  console.log(`\nExamples (top ${examplesCompetitive.length}):`);
  for (const e of examplesCompetitive) {
    console.log(`  ${new Date(e.when).toLocaleDateString()} ${e.resolved} ${e.userFb ? `[user: ${e.userFb}]` : ''}`);
    console.log(`    candidates: ${e.cands.join(' | ')}`);
  }

  console.log('\n═══ Q2: When competitive, are we actually wrong? ═══');
  const cFb = competitiveAndUserSaidWrong + competitiveButUserConfirmed;
  if (cFb === 0) {
    console.log('Not enough user feedback in the competitive subset to compute. (User rarely taps the buttons.)');
  } else {
    console.log(`Of ${cFb} competitive events with user feedback: ${competitiveAndUserSaidWrong} wrong, ${competitiveButUserConfirmed} correct → ${(100*competitiveAndUserSaidWrong/cFb).toFixed(0)}% wrong-rate.`);
  }

  console.log('\n═══ Q3: Block-level ambiguity (same-street, multi-segment) ═══');
  console.log('NOTE: snap_to_nearest_street collapses to 1 row per street name (DISTINCT ON sname).');
  console.log('To detect "wrong block of Wolcott" we need a NEW RPC that returns top-N segments PER street.');
  console.log(`Examples where the resolved street has multiple segments anywhere (not yet localized):`);
  for (const e of examplesBlock) {
    console.log(`  ${new Date(e.when).toLocaleDateString()} ${e.resolved} — ${e.streetSegmentCount} segments, ${e.uniqueRanges} unique ranges (citywide)`);
  }
})();
