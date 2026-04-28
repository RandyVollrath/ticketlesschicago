/**
 * Smoke test: parking-quality-diagnose classifier suppresses snap_far when
 * Mapbox-reverse confirms the snap. Run with the recent parking_diagnostics
 * window so we exercise real rows and see whether reclassification flips the
 * digest signal.
 *
 * Run: npx tsx scripts/smoke-test-parking-quality-classifier.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { diagnose } from '../lib/parking-quality-diagnose';

async function main() {
  const report = await diagnose(36);
  console.log(`window: ${report.window_start} → ${report.window_end}`);
  console.log(`total rows: ${report.total_rows}`);
  console.log('overall failure counts:');
  for (const [sig, count] of Object.entries(report.overall_failure_counts)) {
    if ((count as number) > 0) console.log(`  ${sig}: ${count}`);
  }
  console.log('\ntop signatures:');
  for (const t of report.top_signatures) {
    console.log(`  ${t.signature} ×${t.count} (${t.userCount} users)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
