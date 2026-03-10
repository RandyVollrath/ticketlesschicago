/**
 * Apply FOIA stats migration via Supabase Management API
 *
 * The Supabase Management API allows running arbitrary SQL via:
 *   POST https://api.supabase.com/v1/projects/{ref}/database/query
 *   Header: Authorization: Bearer <access_token>
 *   Body: { "query": "SQL here" }
 *
 * Alternatively, uses psql if DATABASE_URL is available.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> npx ts-node scripts/apply-foia-migration.ts
 *   (Get token from: supabase login, or https://supabase.com/dashboard/account/tokens)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const PROJECT_REF = 'dzhqolbhuqdcpngdayuq';
const MIGRATION_FILE = path.join(__dirname, '..', 'supabase', 'migrations', '20260310_foia_block_ticket_stats.sql');

function getAccessToken(): string {
  // Check env
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;

  // Check common locations
  const homeDir = process.env.HOME || '';
  const paths = [
    path.join(homeDir, '.config', 'supabase', 'access-token'),
    path.join(homeDir, '.supabase', 'access-token'),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8').trim();
    }
  }

  throw new Error(
    'No Supabase access token found.\n' +
    'Set SUPABASE_ACCESS_TOKEN env var or run: supabase login\n' +
    'Or get a token from: https://supabase.com/dashboard/account/tokens'
  );
}

function runQuery(token: string, sql: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== Apply FOIA Migration ===\n');

  const token = getAccessToken();
  console.log(`Token found (${token.length} chars)`);

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
  console.log(`Migration SQL: ${sql.length} chars from ${path.basename(MIGRATION_FILE)}`);

  // Split SQL into statements and run them individually
  // (some statements like CREATE TABLE + CREATE INDEX can fail independently)
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`\n${statements.length} SQL statements to execute\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}...`);

    try {
      await runQuery(token, stmt + ';');
      console.log(' OK');
    } catch (err: any) {
      console.log(` ERROR: ${err.message?.substring(0, 200)}`);
    }
  }

  console.log('\n=== Migration Complete ===');

  // Verify tables exist
  console.log('\nVerifying tables...');
  try {
    const result = await runQuery(token, `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'foia_%'
      ORDER BY table_name;
    `);
    console.log('FOIA tables:', JSON.stringify(result));
  } catch (err: any) {
    console.error('Verify error:', err.message);
  }

  // Verify RPC functions
  try {
    const result = await runQuery(token, `
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name LIKE 'get_%ticket%'
      ORDER BY routine_name;
    `);
    console.log('RPC functions:', JSON.stringify(result));
  } catch (err: any) {
    console.error('RPC verify error:', err.message);
  }
}

main().catch(console.error);
