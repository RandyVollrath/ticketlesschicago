#!/usr/bin/env npx tsx
/**
 * Probe — answers Randy's question:
 *   "For my recent parkings, would the pipeline have known there were
 *    2-3 plausible candidate streets/blocks at parking time?"
 *
 * Pulls the last N parking_diagnostics rows for a user, then for each row
 * re-calls snap_to_nearest_street(raw_lat, raw_lng, 80) to see the full
 * candidate pool the pipeline had to choose from. Prints them side-by-side
 * with what we ended up resolving + any user feedback that came in.
 *
 * Usage:
 *   npx tsx scripts/probe-recent-parking-candidates.ts [--email <addr>] [--limit 20]
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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) { console.error('Missing Supabase creds'); process.exit(1); }

const args = process.argv.slice(2);
const emailIdx = args.indexOf('--email');
const limitIdx = args.indexOf('--limit');
const email = emailIdx >= 0 ? args[emailIdx + 1] : 'randyvollrath@gmail.com';
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 20;

const s = createClient(URL, KEY);

(async () => {
  const { data: usersList } = await s.auth.admin.listUsers({ perPage: 1000 });
  const user = (usersList?.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) { console.error(`No user with email ${email}`); process.exit(1); }
  console.log(`User: ${email} (${user.id})\n`);

  const { data: rows, error } = await s
    .from('parking_diagnostics')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error(error); process.exit(1); }
  if (!rows?.length) { console.log('No parking_diagnostics rows.'); return; }

  console.log(`Last ${rows.length} parking events:\n${'='.repeat(80)}\n`);

  for (const r of rows) {
    const when = new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
    console.log(`[${when}] ${r.resolved_address || '(no resolved address)'}`);
    console.log(`  raw GPS: ${r.raw_lat?.toFixed(6)}, ${r.raw_lng?.toFixed(6)} (acc=${r.raw_accuracy_meters ?? '?'}m)`);
    console.log(`  resolved: snap=${r.snap_street_name ?? 'null'} (${r.snap_distance_meters?.toFixed(1) ?? '?'}m) | nominatim=${r.nominatim_street ?? 'null'}${r.nominatim_overrode ? ' [OVERRODE]' : ''}`);
    console.log(`  flags: near_intersection=${r.near_intersection} candidates=${r.snap_candidates_count ?? '?'} confidence=${r.address_confidence ?? '?'}`);
    if (r.user_feedback_at) {
      console.log(`  user feedback: street_correct=${r.street_correct} side_correct=${r.side_correct} loc_err=${r.location_error_meters ?? '?'}m`);
    }

    if (typeof r.raw_lat === 'number' && typeof r.raw_lng === 'number') {
      const { data: snap, error: snapErr } = await s.rpc('snap_to_nearest_street', {
        user_lat: r.raw_lat,
        user_lng: r.raw_lng,
        search_radius_meters: 80,
      });
      if (snapErr) {
        console.log(`  candidates: <rpc error: ${snapErr.message}>`);
      } else {
        const cands = (snap || []).filter((c: any) => c.was_snapped);
        if (!cands.length) {
          console.log('  candidates: <none within 80m>');
        } else {
          console.log(`  candidates (${cands.length}):`);
          for (let i = 0; i < cands.length; i++) {
            const c = cands[i];
            const dist = c.snap_distance_meters?.toFixed(1) ?? '?';
            const range = (c.l_from_addr && c.l_to_addr) ? `[${c.l_from_addr}-${c.l_to_addr}]` : '';
            console.log(`    ${i + 1}. ${c.street_name} ${range} — ${dist}m (${c.snap_source})`);
          }
        }
      }
    }
    console.log('');
  }
})();
