#!/usr/bin/env node
/**
 * Fetch a mobile debug report out of Supabase and unpack it to disk.
 *
 * Usage:
 *   node scripts/fetch-debug-report.js                      # latest across all users
 *   node scripts/fetch-debug-report.js --user <email>       # latest for one user
 *   node scripts/fetch-debug-report.js --id <audit-log-id>  # by audit_logs.id (uuid)
 *   node scripts/fetch-debug-report.js --list [N]           # list recent N (default 10)
 *   node scripts/fetch-debug-report.js --out <dir>          # override output dir
 *
 * Output goes to TicketlessChicagoMobile/logs/remote_<id>/ with:
 *   - parking_detection.log / .prev  (and parking_decisions.ndjson / .prev)
 *   - metadata.json        — app state, pipeline health, counts, note, collected_at
 *   - history.json         — local parking history items
 *   - queue.json           — parking save retry queue
 *   - recent_js_logs.json  — in-memory JS Logger buffer
 *   - summary.txt          — human-readable one-pager
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey);

function parseArgs(argv) {
  const out = { mode: 'latest' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') { out.mode = 'id'; out.id = argv[++i]; }
    else if (a === '--user') { out.userEmail = argv[++i]; }
    else if (a === '--list') {
      out.mode = 'list';
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.listN = parseInt(next, 10); i++; }
    }
    else if (a === '--out') { out.outDir = argv[++i]; }
    else if (a === '-h' || a === '--help') { out.mode = 'help'; }
  }
  return out;
}

async function resolveUserId(email) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id,email')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  if (!data) throw new Error(`no user_profile for email=${email}`);
  return data.user_id;
}

async function listRecent(n, userId) {
  let q = supabase
    .from('audit_logs')
    .select('id,created_at,user_id,action_details,status')
    .eq('action_type', 'mobile_debug_report')
    .order('created_at', { ascending: false })
    .limit(n);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(`list failed: ${error.message}`);
  if (!data?.length) { console.log('(no reports)'); return; }
  console.log(`id                                   created_at                platform  version  size     note`);
  console.log(`${'-'.repeat(120)}`);
  for (const r of data) {
    const d = r.action_details || {};
    const size = d.payload_size_bytes ? `${(d.payload_size_bytes / 1024).toFixed(0)}KB`.padEnd(8) : 'n/a     ';
    const plat = (d.platform || '?').padEnd(8);
    const ver = (d.app_version || '?').padEnd(8);
    const note = (d.note || '').slice(0, 60);
    console.log(`${r.id}  ${r.created_at}  ${plat}  ${ver}  ${size}  ${note}`);
  }
}

async function fetchOne({ id, userId }) {
  let q = supabase
    .from('audit_logs')
    .select('id,created_at,user_id,action_details,status')
    .eq('action_type', 'mobile_debug_report')
    .order('created_at', { ascending: false })
    .limit(1);
  if (id) q = q.eq('id', id).limit(1);
  else if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(`fetch failed: ${error.message}`);
  if (!data?.length) throw new Error('no matching debug report');
  return data[0];
}

function writeIfString(file, value) {
  if (typeof value === 'string' && value.length > 0) {
    fs.writeFileSync(file, value);
    return value.length;
  }
  return 0;
}

function unpackReport(row, outRoot) {
  const details = row.action_details || {};
  const payload = details.payload || {};
  const nativeLogs = payload.native_logs || {};
  const appState = payload.app_state || {};
  const slug = row.id.split('-')[0];
  const outDir = path.resolve(outRoot, `remote_${slug}`);
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];

  for (const [filename, contents] of Object.entries(nativeLogs)) {
    const base = path.basename(filename);
    const out = path.join(outDir, base);
    const n = writeIfString(out, contents);
    if (n > 0) written.push(`${base} (${n.toLocaleString()} bytes)`);
  }

  const writeJson = (name, value) => {
    if (value == null) return;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2));
    written.push(name);
  };

  writeJson('metadata.json', {
    id: row.id,
    created_at: row.created_at,
    user_id: row.user_id,
    status: row.status,
    app_version: details.app_version,
    platform: details.platform,
    note: details.note,
    payload_size_bytes: details.payload_size_bytes,
    collected_at: payload.collected_at,
    app_state: appState,
    native_log_info: payload.native_log_info,
    pipeline_health: payload.pipeline_health,
    last_parked_coords: payload.last_parked_coords,
    last_parking_check: payload.last_parking_check,
  });
  writeJson('history.json', payload.local_parking_history);
  writeJson('queue.json', payload.parking_save_retry_queue);
  writeJson('recent_js_logs.json', payload.recent_js_logs);

  const hist = payload.local_parking_history || {};
  const queue = payload.parking_save_retry_queue || {};
  const health = payload.pipeline_health || {};
  const summary = [
    `Debug report ${row.id}`,
    `  created_at:  ${row.created_at}`,
    `  user:        ${appState.user_email || row.user_id}`,
    `  platform:    ${appState.platform} ${appState.platform_version || ''}`,
    `  app_version: ${appState.app_version}`,
    `  auth:        ${appState.is_authenticated ? 'yes' : 'NO'}`,
    `  fcm_token:   ${appState.fcm_token_present ? appState.fcm_token_preview : 'MISSING'}`,
    `  note:        ${details.note || '(none)'}`,
    '',
    `History:        ${hist.count ?? 0} items`,
    `Retry queue:    ${queue.count ?? 0} items`,
    `Pipeline health: ${JSON.stringify(health)}`,
    '',
    `Files written (${written.length}):`,
    ...written.map((w) => `  - ${w}`),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary + '\n');

  return { outDir, summary };
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.mode === 'help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 18).join('\n').replace(/^ \* ?/gm, ''));
    return;
  }

  const userId = args.userEmail ? await resolveUserId(args.userEmail) : null;

  if (args.mode === 'list') {
    await listRecent(args.listN || 10, userId);
    return;
  }

  const row = await fetchOne({ id: args.id, userId });
  const outRoot = args.outDir
    ? path.resolve(args.outDir)
    : path.resolve(__dirname, '..', 'TicketlessChicagoMobile', 'logs');
  const { outDir, summary } = unpackReport(row, outRoot);
  console.log(summary);
  console.log(`\nWrote to: ${outDir}`);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
