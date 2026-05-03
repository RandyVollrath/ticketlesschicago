#!/usr/bin/env npx tsx
/**
 * Apply the snap_to_nearest_street_with_blocks migration to production
 * Supabase via the exec_sql RPC. Idempotent: CREATE OR REPLACE.
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
const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260427000000_snap_with_blocks.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  console.log(`Applying ${path.basename(sqlPath)} (${sql.length} chars)...`);

  // Try the exec_sql parameter name variants this codebase has used in the past.
  // Different scripts disagree on the param name, so we probe.
  const variants: Array<Record<string, string>> = [
    { sql_string: sql },
    { sql_query: sql },
    { query: sql },
    { sql: sql },
  ];

  let applied = false;
  let lastErr: any = null;
  for (const params of variants) {
    const paramName = Object.keys(params)[0];
    const { data, error } = await s.rpc('exec_sql', params as any);
    if (!error) {
      console.log(`✅ Migration applied via exec_sql({ ${paramName}: ... })`);
      if (data) console.log(`   returned: ${JSON.stringify(data).slice(0, 200)}`);
      applied = true;
      break;
    }
    lastErr = error;
    console.log(`  ✗ exec_sql({ ${paramName} }): ${error.message}`);
  }

  if (!applied) {
    console.error('All exec_sql parameter variants failed. Last error:', lastErr);
    process.exit(1);
  }

  // Verify the function exists by calling it with a known Chicago coordinate.
  console.log('\nSmoke-testing the new function...');
  const { data: testRows, error: testErr } = await s.rpc('snap_to_nearest_street_with_blocks', {
    user_lat: 41.968906,
    user_lng: -87.675706,
    search_radius_meters: 80,
    max_per_street: 2,
    max_total: 8,
  });
  if (testErr) {
    console.error('❌ Smoke test failed:', testErr.message);
    process.exit(1);
  }
  const cands = (testRows as any[] || []).filter((c: any) => c.was_snapped);
  console.log(`✅ Smoke test: ${cands.length} candidates returned at the Lawrence/Wolcott corner.`);
  for (const c of cands) {
    const range = (c.l_from_addr && c.l_to_addr) ? `[${c.l_from_addr}-${c.l_to_addr}]` : '';
    console.log(`   - ${c.street_name} ${range} — ${c.snap_distance_meters?.toFixed(1)}m (${c.snap_source})`);
  }
})();
