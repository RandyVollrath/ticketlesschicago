#!/usr/bin/env tsx
/**
 * Sticker renewal worker. Long-running poll loop or one-shot run.
 *
 * Lives on the SAME worker machine as scripts/run-city-payment-queue.ts
 * because:
 *   - The Stripe Issuing card env vars (CITY_PAYMENT_CARD_*) live there
 *     and never go into Vercel
 *   - Playwright sessions are long-running; better outside Vercel functions
 *
 * Loop semantics:
 *   - Atomically claims one granted consent at a time (claimed_at set)
 *   - Processes via lib/run-granted-consents.processConsent
 *   - Sleeps POLL_INTERVAL_MS between idle polls
 *   - Stops after RENEWAL_WORKER_MAX_BATCH consents in --once mode
 *
 * Usage:
 *   tsx scripts/run-renewal-queue.ts            # long-running daemon
 *   tsx scripts/run-renewal-queue.ts --once     # process up to N then exit
 *   tsx scripts/run-renewal-queue.ts --dry      # forces RENEWAL_DRY_RUN=true
 *
 * Required env (worker machine, plus normal Supabase + Stripe vars):
 *   AUTO_RENEWAL_GLOBALLY_ENABLED   must be true or worker no-ops
 *   CREDENTIALS_ENCRYPTION_KEY      to decrypt IL Reg ID + PIN
 *   CITY_PAYMENT_CARD_*             ops card for gov payments
 *   RESEND_API_KEY                  user + admin emails
 *
 * Optional env:
 *   RENEWAL_DRY_RUN=true            skip Stripe + dry-run automation
 *   RENEWAL_WORKER_ID=hostname      identifier in claimed_by (default: os.hostname)
 *   RENEWAL_WORKER_MAX_BATCH=5      max consents per --once run
 *   POLL_INTERVAL_MS=60000          sleep between idle polls
 */

import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { claimGrantedConsent, processConsent, isPipelineEnabled } from '../lib/run-granted-consents';

const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once');
if (args.has('--dry')) process.env.RENEWAL_DRY_RUN = 'true';

const WORKER_ID = process.env.RENEWAL_WORKER_ID || os.hostname() || 'unknown-worker';
const MAX_BATCH = parseInt(process.env.RENEWAL_WORKER_MAX_BATCH || '5', 10);
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);

let stopping = false;
process.on('SIGINT', () => { console.log('SIGINT — finishing current job then exiting'); stopping = true; });
process.on('SIGTERM', () => { console.log('SIGTERM — finishing current job then exiting'); stopping = true; });

async function tickOnce(): Promise<boolean> {
  if (!isPipelineEnabled()) {
    console.log('AUTO_RENEWAL_GLOBALLY_ENABLED is not true — sleeping');
    return false;
  }
  const consent = await claimGrantedConsent(WORKER_ID);
  if (!consent) return false;
  console.log(`[${new Date().toISOString()}] processing consent ${consent.id} (${consent.renewal_type})`);
  try {
    const outcome = await processConsent(consent);
    console.log(`  → ${outcome.outcome}${outcome.detail ? ': ' + outcome.detail : ''}`);
  } catch (e: any) {
    console.error('  EXCEPTION:', e?.message || e);
  }
  return true;
}

async function main() {
  console.log(`Renewal worker ${WORKER_ID} starting (mode=${ONCE ? 'once' : 'daemon'}, max_batch=${MAX_BATCH}, poll=${POLL_MS}ms, dry_run=${process.env.RENEWAL_DRY_RUN || 'false'})`);

  if (ONCE) {
    let processed = 0;
    while (processed < MAX_BATCH && !stopping) {
      const did = await tickOnce();
      if (!did) break;
      processed++;
    }
    console.log(`done (processed=${processed})`);
    return;
  }

  while (!stopping) {
    const did = await tickOnce();
    if (!did) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  console.log('worker exiting');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
