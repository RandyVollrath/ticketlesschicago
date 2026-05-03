/**
 * Contest channel-mix report.
 *
 * Counts how many contest letters went out via the City's eContest portal
 * (Correspondence) vs Lob USPS mail, and breaks the eContest attempts down
 * into success / fallback / never-tried.
 *
 * Source of truth = `ticket_audit_log` action rows written by the mail cron
 * in `pages/api/cron/autopilot-mail-letters.ts`:
 *
 *   letter_econtest_packet_built     — packet rendered, eContest about to be tried
 *   letter_submitted_online          — eContest succeeded; no Lob mail sent
 *   letter_econtest_failed_fallback  — eContest tried + failed; Lob took over
 *   letter_mailed                    — Lob mailed the letter (real or test mode)
 *
 * Usage:
 *   npm run report:channel-mix              (last 30 days)
 *   npm run report:channel-mix -- --days=7
 *   npm run report:channel-mix -- --since=2026-01-01
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function arg(flag: string): string | null {
  const m = process.argv.find(a => a.startsWith(`--${flag}=`));
  return m ? m.slice(`--${flag}=`.length) : null;
}

async function countAction(action: string, since: string): Promise<number> {
  const { count, error } = await s
    .from('ticket_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('action', action)
    .gte('created_at', since);
  if (error) throw new Error(`${action}: ${error.message}`);
  return count || 0;
}

async function countActionByViolation(action: string, since: string): Promise<Record<string, number>> {
  // Pull the rows; fan out by joined violation_type. Limit to a reasonable
  // page size — even at 5K letters/yr this report stays under a couple pages.
  const out: Record<string, number> = {};
  let from = 0;
  const PAGE = 500;
  while (true) {
    const { data, error } = await s
      .from('ticket_audit_log')
      .select('ticket_id, detected_tickets!inner(violation_type)')
      .eq('action', action)
      .gte('created_at', since)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${action} groupby: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as any[]) {
      const v = r.detected_tickets?.violation_type || 'unknown';
      out[v] = (out[v] || 0) + 1;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

(async () => {
  let since: string;
  if (arg('since')) {
    since = new Date(arg('since')!).toISOString();
  } else {
    const days = Number(arg('days') || '30');
    since = new Date(Date.now() - days * 86400_000).toISOString();
  }

  const sinceLabel = since.slice(0, 10);
  console.log(`Contest channel mix since ${sinceLabel}\n`);

  const [packetBuilt, eContestOk, eContestFallback, lobMailed] = await Promise.all([
    countAction('letter_econtest_packet_built', since),
    countAction('letter_submitted_online', since),
    countAction('letter_econtest_failed_fallback', since),
    countAction('letter_mailed', since),
  ]);

  const eContestAttempts = packetBuilt; // every packet build = an eContest attempt
  const lobOnly = Math.max(0, lobMailed - eContestFallback); // Lob runs that did not follow an eContest attempt
  const totalDelivered = eContestOk + lobMailed;

  const pct = (n: number, d: number) => d ? `${((n / d) * 100).toFixed(1)}%` : '—';

  console.log('Top-line:');
  console.log(`  Letters delivered (eContest succeeded + Lob mailed):  ${totalDelivered}`);
  console.log(`    via City eContest portal (Correspondence):          ${eContestOk.toString().padStart(5)}  ${pct(eContestOk, totalDelivered)}`);
  console.log(`    via Lob USPS mail (P.O. Box 88292):                 ${lobMailed.toString().padStart(5)}  ${pct(lobMailed, totalDelivered)}`);

  console.log('\neContest attempt funnel:');
  console.log(`  Packets built (eContest attempted):                   ${eContestAttempts}`);
  console.log(`    succeeded online:                                   ${eContestOk.toString().padStart(5)}  ${pct(eContestOk, eContestAttempts)}`);
  console.log(`    fell back to Lob (no Correspondence offered, etc.): ${eContestFallback.toString().padStart(5)}  ${pct(eContestFallback, eContestAttempts)}`);
  console.log(`  Lob runs that never tried eContest:                   ${lobOnly}`);

  console.log('\neContest success rate by violation type (where attempted):');
  const [byPacket, byOk, byFallback] = await Promise.all([
    countActionByViolation('letter_econtest_packet_built', since),
    countActionByViolation('letter_submitted_online', since),
    countActionByViolation('letter_econtest_failed_fallback', since),
  ]);
  const allKeys = Array.from(new Set([...Object.keys(byPacket), ...Object.keys(byOk), ...Object.keys(byFallback)])).sort();
  if (allKeys.length === 0) {
    console.log('  (no eContest attempts in this window)');
  } else {
    console.log('  violation_type                   attempts  online  fallback  success%');
    for (const k of allKeys) {
      const a = byPacket[k] || 0;
      const o = byOk[k] || 0;
      const f = byFallback[k] || 0;
      console.log(
        `  ${k.padEnd(32)} ${a.toString().padStart(8)}  ${o.toString().padStart(6)}  ${f.toString().padStart(8)}  ${pct(o, a).padStart(8)}`
      );
    }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
