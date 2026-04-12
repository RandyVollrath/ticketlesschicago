#!/usr/bin/env npx ts-node
/**
 * Portal Worker — Distributed Scraper for Multiple Machines
 *
 * This script lets you run the portal scraper across multiple machines
 * (e.g., 2-3 Mac Minis). Each machine claims a batch of plates from
 * Supabase, checks them, and writes results back.
 *
 * HOW IT WORKS (like a grocery store checkout):
 * - There's a shared list of plates that need checking (the "queue")
 * - Each machine grabs a batch of unclaimed plates ("I'll take these 50")
 * - It marks them as "in progress" so no other machine grabs them
 * - It checks each plate on the Chicago portal
 * - It writes results back to the database
 * - If a machine crashes, its plates get released after 30 minutes
 *
 * SETUP ON A NEW MACHINE:
 * 1. Clone the repo
 * 2. npm install
 * 3. npx playwright install chromium
 * 4. Copy .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * 5. Run: WORKER_ID=mac-mini-1 npx ts-node scripts/portal-worker.ts
 *
 * ENVIRONMENT VARIABLES:
 *   WORKER_ID          — Unique name for this machine (default: hostname)
 *   WORKER_BATCH_SIZE  — Plates per batch (default: 50)
 *   WORKER_CONCURRENCY — Parallel browsers on this machine (default: 2)
 *   WORKER_DELAY_MS    — Delay between lookups per browser (default: 5000)
 */

import { createClient } from '@supabase/supabase-js';
import { lookupMultiplePlatesParallel, LookupResult } from '../lib/chicago-portal-scraper';
import * as os from 'os';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configuration
const WORKER_ID = process.env.WORKER_ID || os.hostname();
const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '50', 10);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
const DELAY_MS = parseInt(process.env.WORKER_DELAY_MS || '5000', 10);
const LOCK_TIMEOUT_MINUTES = 30; // Release plates if worker dies

async function main() {
  console.log('============================================');
  console.log(`  Portal Worker: ${WORKER_ID}`);
  console.log(`  Batch size: ${BATCH_SIZE}, Concurrency: ${CONCURRENCY}`);
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('============================================\n');

  // Step 1: Check kill switches
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['kill_all_checks', 'maintenance_mode']);

  for (const setting of settings || []) {
    if (setting.key === 'kill_all_checks' && setting.value?.enabled) {
      console.log('Kill switch active. Exiting.');
      return;
    }
    if (setting.key === 'maintenance_mode' && setting.value?.enabled) {
      console.log(`Maintenance mode: ${setting.value.message}. Exiting.`);
      return;
    }
  }

  // Step 2: Release stale locks (from crashed workers)
  const staleCutoff = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  const { data: staleReleased } = await supabaseAdmin
    .from('monitored_plates')
    .update({
      worker_id: null,
      worker_claimed_at: null,
    })
    .not('worker_id', 'is', null)
    .lt('worker_claimed_at', staleCutoff)
    .select('id');

  if (staleReleased && staleReleased.length > 0) {
    console.log(`Released ${staleReleased.length} stale locks from crashed workers\n`);
  }

  // Step 3: Get active subscriptions
  const { data: subscriptions } = await supabaseAdmin
    .from('autopilot_subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .is('authorization_revoked_at', null);

  if (!subscriptions || subscriptions.length === 0) {
    console.log('No active subscriptions. Exiting.');
    return;
  }

  const activeUserIds = subscriptions.map(s => s.user_id);

  // Step 4: Claim a batch of unchecked plates
  // Prioritize plates that haven't been checked recently
  const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();

  const { data: claimedPlates, error: claimError } = await supabaseAdmin
    .from('monitored_plates')
    .update({
      worker_id: WORKER_ID,
      worker_claimed_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .is('worker_id', null) // Not already claimed
    .in('user_id', activeUserIds)
    .or(`last_checked_at.is.null,last_checked_at.lt.${twentyHoursAgo}`)
    .limit(BATCH_SIZE)
    .select('id, user_id, plate, state');

  if (claimError) {
    console.error('Failed to claim plates:', claimError.message);
    return;
  }

  if (!claimedPlates || claimedPlates.length === 0) {
    console.log('No unchecked plates available — another worker may have them, or all are recent.');
    return;
  }

  console.log(`Claimed ${claimedPlates.length} plates for checking\n`);

  // Step 5: Get user profiles for last names
  const userIds = [...new Set(claimedPlates.map(p => p.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, last_name')
    .in('user_id', userIds);

  const lastNameMap = new Map<string, string>();
  for (const p of profiles || []) {
    lastNameMap.set(p.user_id, p.last_name || 'Owner');
  }

  // Step 6: Run the parallel scraper
  const lookupList = claimedPlates.map(p => ({
    plate: p.plate,
    state: p.state,
    lastName: lastNameMap.get(p.user_id) || 'Owner',
  }));

  let results: LookupResult[];
  try {
    results = await lookupMultiplePlatesParallel(lookupList, {
      delayBetweenMs: DELAY_MS,
      concurrency: CONCURRENCY,
    });
  } catch (err: any) {
    console.error(`Scraper crashed: ${err.message}`);
    // Release all claimed plates so another worker can try
    await releasePlates(claimedPlates.map(p => p.id));
    return;
  }

  // Step 7: Write results back
  let ticketsFound = 0;
  let errors = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const plateInfo = claimedPlates[i];

    if (result.error) {
      errors++;
      console.log(`  ${result.plate}: ERROR - ${result.error}`);
    } else {
      ticketsFound += result.tickets.length;

      // Save each ticket to portal_check_results
      for (const ticket of result.tickets) {
        try {
          await supabaseAdmin
            .from('portal_check_results')
            .upsert({
              ticket_number: ticket.ticket_number,
              plate: plateInfo.plate,
              state: plateInfo.state || 'IL',
              ticket_queue: ticket.ticket_queue || null,
              hearing_disposition: ticket.hearing_disposition || null,
              current_amount_due: ticket.current_amount_due ?? 0,
              original_amount: ticket.original_amount ?? ticket.current_amount_due ?? 0,
              violation_description: ticket.violation_description || null,
              issue_date: ticket.issue_date || null,
              raw_response: ticket.raw_text || null,
              checked_at: new Date().toISOString(),
            }, { onConflict: 'ticket_number', ignoreDuplicates: true });
        } catch (err: any) {
          console.warn(`    Failed to save result for ${ticket.ticket_number}: ${err.message}`);
        }
      }
    }

    // Update last_checked_at and release lock
    await supabaseAdmin
      .from('monitored_plates')
      .update({
        last_checked_at: new Date().toISOString(),
        worker_id: null,
        worker_claimed_at: null,
      })
      .eq('id', plateInfo.id);
  }

  // Step 8: Log the run
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      action: 'worker_portal_check_complete',
      details: {
        worker_id: WORKER_ID,
        plates_checked: results.length,
        tickets_found: ticketsFound,
        errors,
        concurrency: CONCURRENCY,
        duration_ms: results.reduce((sum, r) => sum + r.lookup_duration_ms, 0),
      },
    });

  console.log('\n============================================');
  console.log(`  Worker ${WORKER_ID} Complete`);
  console.log(`  Plates checked: ${results.length}`);
  console.log(`  Tickets found: ${ticketsFound}`);
  console.log(`  Errors: ${errors}`);
  console.log('============================================');
}

async function releasePlates(plateIds: string[]) {
  console.log(`Releasing ${plateIds.length} claimed plates...`);
  for (const id of plateIds) {
    await supabaseAdmin
      .from('monitored_plates')
      .update({ worker_id: null, worker_claimed_at: null })
      .eq('id', id);
  }
}

main().catch(err => {
  console.error('Worker failed:', err);
  process.exit(1);
});
