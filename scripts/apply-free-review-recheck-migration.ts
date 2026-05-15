#!/usr/bin/env npx tsx
/**
 * Apply supabase/migrations/20260515_free_review_recheck_monitor.sql.
 *
 * Run:
 *   SUPABASE_DB_PASSWORD=... npx tsx scripts/apply-free-review-recheck-migration.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client as PgClient } from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../.env.local') });
dotenv.config({ path: join(__dirname, '../.env') });

async function main() {
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) throw new Error('Missing SUPABASE_DB_PASSWORD');

  const projectRef = readFileSync(join(__dirname, '../supabase/.temp/project-ref'), 'utf-8').trim();
  const poolerUrl = readFileSync(join(__dirname, '../supabase/.temp/pooler-url'), 'utf-8').trim();
  const m = poolerUrl.match(/@([^:/]+):(\d+)\//);
  if (!m) throw new Error(`Could not parse pooler URL: ${poolerUrl}`);
  const host = m[1];
  const port = parseInt(m[2], 10);

  console.log(`Connecting to ${host}:${port} as postgres.${projectRef}…`);
  const client = new PgClient({
    host, port, database: 'postgres',
    user: `postgres.${projectRef}`, password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const migration = readFileSync(
    join(__dirname, '../supabase/migrations/20260515_free_review_recheck_monitor.sql'),
    'utf-8',
  );
  console.log(`Applying migration (${migration.length} chars)…`);
  try {
    await client.query(migration);
    console.log('Migration ran without error.');
  } catch (err: any) {
    console.error('Migration failed:', err.message);
    await client.end();
    process.exit(1);
  }
  await client.end();

  // Verify the new columns landed.
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await (s as any)
    .from('free_review_requests')
    .select('id, monitor_enabled, last_known_ticket_numbers, unsubscribe_token, recheck_count')
    .limit(1);
  if (error) {
    console.error('Verification failed:', error.message);
    process.exit(1);
  }
  console.log('✅ recheck monitor columns are live on free_review_requests');
}

main().catch((e) => { console.error(e); process.exit(1); });
