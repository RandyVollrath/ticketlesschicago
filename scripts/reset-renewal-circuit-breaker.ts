#!/usr/bin/env tsx
/**
 * Manually reset a renewal circuit breaker after investigating the failures.
 *
 * Usage:
 *   tsx scripts/reset-renewal-circuit-breaker.ts <city_sticker|license_plate> --by <admin-email>
 *   tsx scripts/reset-renewal-circuit-breaker.ts list
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { getCircuitBreaker, resetCircuitBreaker } from '../lib/renewal-failure-recovery';

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'list' || !cmd) {
    for (const t of ['city_sticker', 'license_plate'] as const) {
      const cb = await getCircuitBreaker(t);
      console.log(`\n${t}:`);
      if (!cb) {
        console.log('  (no row found)');
        continue;
      }
      console.log(`  paused: ${cb.paused_at ? 'YES — ' + cb.paused_reason : 'no'}`);
      console.log(`  consecutive_failures: ${cb.consecutive_failures}`);
      console.log(`  last_failure_at: ${cb.last_failure_at || '(none)'}`);
      console.log(`  last_failure_reason: ${cb.last_failure_reason || '(none)'}`);
      console.log(`  last_success_at: ${cb.last_success_at || '(none)'}`);
    }
    return;
  }

  if (cmd !== 'city_sticker' && cmd !== 'license_plate') {
    console.error('Usage: tsx scripts/reset-renewal-circuit-breaker.ts <city_sticker|license_plate> --by <admin-email>');
    console.error('   or: tsx scripts/reset-renewal-circuit-breaker.ts list');
    process.exit(2);
  }

  const byIdx = args.indexOf('--by');
  const by = byIdx >= 0 ? args[byIdx + 1] : process.env.ADMIN_EMAIL || 'unknown-admin';

  await resetCircuitBreaker(cmd, by);
  console.log(`✅ Reset ${cmd} circuit breaker (by ${by})`);
  const cb = await getCircuitBreaker(cmd);
  console.log('New state:', cb);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
