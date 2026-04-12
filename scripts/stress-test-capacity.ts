#!/usr/bin/env npx ts-node
/**
 * Capacity Stress Test
 *
 * Simulates load at various user counts to identify where the system breaks.
 * Does NOT create real users or hit external APIs — just measures internal
 * throughput and identifies bottlenecks.
 *
 * Run: npx ts-node scripts/stress-test-capacity.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TestResult {
  test: string;
  duration_ms: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

const results: TestResult[] = [];

async function timeQuery(name: string, fn: () => Promise<any>, warnMs: number, failMs: number): Promise<any> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    const status = duration > failMs ? 'FAIL' : duration > warnMs ? 'WARN' : 'PASS';
    results.push({ test: name, duration_ms: duration, status, detail: `${duration}ms` });
    return result;
  } catch (err: any) {
    const duration = Date.now() - start;
    results.push({ test: name, duration_ms: duration, status: 'FAIL', detail: err.message });
    return null;
  }
}

async function main() {
  console.log('============================================');
  console.log('  CAPACITY STRESS TEST');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('============================================\n');

  // ── 1. Current scale ──
  console.log('--- Current Scale ---\n');

  const subs = await timeQuery(
    'Count active subscriptions',
    async () => supabaseAdmin.from('autopilot_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    100, 500
  );
  const subCount = subs?.count || 0;
  console.log(`  Active subscriptions: ${subCount}`);

  const plates = await timeQuery(
    'Count active plates',
    async () => supabaseAdmin.from('monitored_plates').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    100, 500
  );
  const plateCount = plates?.count || 0;
  console.log(`  Active plates: ${plateCount}`);

  const tickets = await timeQuery(
    'Count detected tickets (all time)',
    async () => supabaseAdmin.from('detected_tickets').select('*', { count: 'exact', head: true }),
    200, 1000
  );
  console.log(`  Total detected tickets: ${tickets?.count || 0}`);

  const letters = await timeQuery(
    'Count contest letters (all time)',
    async () => supabaseAdmin.from('contest_letters').select('*', { count: 'exact', head: true }),
    200, 1000
  );
  console.log(`  Total contest letters: ${letters?.count || 0}`);

  const pendingReview = await timeQuery(
    'Count letters needing admin review',
    async () => supabaseAdmin.from('contest_letters').select('*', { count: 'exact', head: true }).eq('status', 'needs_admin_review'),
    100, 500
  );
  console.log(`  Letters needing YOUR review: ${pendingReview?.count || 0}`);

  const rateLimitRows = await timeQuery(
    'Count rate_limit rows',
    async () => supabaseAdmin.from('rate_limits').select('*', { count: 'exact', head: true }),
    200, 1000
  );
  console.log(`  Rate limit table rows: ${rateLimitRows?.count || 0}`);

  // ── 2. Database speed tests ──
  console.log('\n--- Database Speed Tests ---\n');

  // Simulate rate limit check (the old bottleneck)
  await timeQuery(
    'Rate limit check query (old bottleneck)',
    async () => supabaseAdmin.from('rate_limits').select('*', { count: 'exact', head: true })
      .eq('identifier', 'stress-test-fake-ip')
      .eq('action', 'checkout')
      .gte('created_at', new Date(Date.now() - 3600000).toISOString()),
    50, 200
  );

  // Simulate fetching monitored plates for scraper
  await timeQuery(
    'Fetch all active plates with user profiles',
    async () => {
      const { data: activeSubs } = await supabaseAdmin
        .from('autopilot_subscriptions')
        .select('user_id')
        .eq('status', 'active');
      if (!activeSubs?.length) return { count: 0 };
      const { data } = await supabaseAdmin
        .from('monitored_plates')
        .select('id, user_id, plate, state')
        .eq('status', 'active')
        .in('user_id', activeSubs.map(s => s.user_id));
      return { count: data?.length || 0 };
    },
    500, 2000
  );

  // Simulate letter query for mailing cron
  await timeQuery(
    'Fetch approved letters ready to mail',
    async () => supabaseAdmin.from('contest_letters')
      .select('id, ticket_id, user_id, status, letter_content, approved_via')
      .in('status', ['approved', 'ready'])
      .limit(50),
    200, 1000
  );

  // Simulate pending letters digest query
  await timeQuery(
    'Fetch letters needing admin review',
    async () => supabaseAdmin.from('contest_letters')
      .select('id, ticket_id, user_id, status, defense_type, updated_at')
      .in('status', ['needs_admin_review', 'approved', 'ready'])
      .order('updated_at', { ascending: false })
      .limit(100),
    200, 1000
  );

  // ── 3. Concurrent connection test ──
  console.log('\n--- Concurrent Query Test ---\n');

  const concurrencyLevels = [5, 10, 20, 50];
  for (const n of concurrencyLevels) {
    await timeQuery(
      `${n} concurrent SELECT queries`,
      async () => {
        const promises = Array.from({ length: n }, () =>
          supabaseAdmin.from('monitored_plates').select('id', { count: 'exact', head: true }).eq('status', 'active')
        );
        await Promise.all(promises);
        return { n };
      },
      n * 30, n * 100
    );
  }

  // ── 4. Projections ──
  console.log('\n--- Capacity Projections ---\n');

  const platesPerUser = plateCount > 0 && subCount > 0 ? plateCount / subCount : 2;
  console.log(`  Plates per user (avg): ${platesPerUser.toFixed(1)}`);
  console.log('');

  const scenarios = [
    { users: 100, label: '100 users' },
    { users: 500, label: '500 users' },
    { users: 1000, label: '1,000 users' },
    { users: 5000, label: '5,000 users' },
    { users: 10000, label: '10,000 users' },
  ];

  for (const s of scenarios) {
    const totalPlates = Math.round(s.users * platesPerUser);
    const scraperHours3Workers = (totalPlates * 8) / 3 / 3600; // ~8s per plate avg, 3 parallel workers
    const ticketsPerMonth = Math.round(s.users * 3); // ~3 tickets/user/month
    const lettersNeedingReview = Math.round(ticketsPerMonth * 0.07); // ~7% need review
    const reviewMinutesPerDay = Math.round(lettersNeedingReview / 30 * 2); // 2 min each
    const lobCostPerMonth = ticketsPerMonth * 2.50;
    const smsCostPerMonth = Math.round(s.users * 0.15 * 3); // 0.15 per ticket SMS

    const scraperStatus = scraperHours3Workers <= 4 ? 'OK' : scraperHours3Workers <= 8 ? 'TIGHT' : 'NEED MORE WORKERS';

    console.log(`  === ${s.label} ===`);
    console.log(`  Plates to scrape daily: ${totalPlates}`);
    console.log(`  Scraper time (3 workers): ${scraperHours3Workers.toFixed(1)} hours [${scraperStatus}]`);
    console.log(`  Tickets/month: ~${ticketsPerMonth}`);
    console.log(`  Letters needing YOUR review/month: ~${lettersNeedingReview} (~${reviewMinutesPerDay} min/day)`);
    console.log(`  Lob postage/month: $${lobCostPerMonth.toLocaleString()}`);
    console.log(`  SMS cost/month: ~$${smsCostPerMonth}`);
    console.log('');
  }

  // ── Summary ──
  console.log('\n============================================');
  console.log('  TEST RESULTS');
  console.log('============================================\n');

  const maxNameLen = Math.max(...results.map(r => r.test.length));
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'OK' : r.status === 'WARN' ? '!!' : 'XX';
    console.log(`  [${icon}] ${r.test.padEnd(maxNameLen)}  ${r.detail}`);
  }

  const fails = results.filter(r => r.status === 'FAIL').length;
  const warns = results.filter(r => r.status === 'WARN').length;
  console.log(`\n  ${results.length} tests: ${results.length - fails - warns} passed, ${warns} warnings, ${fails} failures`);

  if (fails > 0) {
    console.log('\n  ACTION NEEDED: Database queries are slow. Check indexes and connection pooling.');
  }
}

main().catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
