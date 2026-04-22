/**
 * Probe the CHI PAY boot-extension endpoint for a single plate to verify the
 * tow-eligible-date feature works end-to-end before we wire it into alerts.
 *
 * Usage: npx tsx scripts/probe-boot-eligibility.ts <plate> <state> <lastName>
 *   e.g. npx tsx scripts/probe-boot-eligibility.ts FA81246 IL ALMUBAED
 */

import { lookupPlateOnPortal } from '../lib/chicago-portal-scraper';

async function main() {
  const [, , plate, state, lastName] = process.argv;
  if (!plate || !state || !lastName) {
    console.error('Usage: npx tsx scripts/probe-boot-eligibility.ts <plate> <state> <lastName>');
    process.exit(1);
  }

  console.log(`Probing plate=${plate} state=${state} lastName=${lastName}`);
  const t0 = Date.now();
  const result = await lookupPlateOnPortal(plate, state, lastName);
  const elapsed = Date.now() - t0;

  console.log('\n--- LOOKUP RESULT ---');
  console.log(`elapsed: ${elapsed}ms  error: ${result.error ?? 'none'}  tickets: ${result.tickets.length}`);
  if (result.format_warnings.length) {
    console.log('format_warnings:', result.format_warnings);
  }

  console.log('\n--- BOOT ELIGIBILITY ---');
  if (!result.boot_eligibility) {
    console.log('(null — probe did not run or failed catastrophically)');
  } else {
    const b = result.boot_eligibility;
    console.log(`is_booted: ${b.is_booted}`);
    console.log(`tow_eligible_date: ${b.tow_eligible_date ?? '(none)'}`);
    console.log(`tow_extension_eligible: ${b.tow_extension_eligible}`);
    console.log(`api_status: ${b.api_status}`);
    console.log(`raw: ${JSON.stringify(b.raw)?.slice(0, 1000)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
