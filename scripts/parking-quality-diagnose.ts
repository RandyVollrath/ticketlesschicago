#!/usr/bin/env npx tsx
/**
 * Parking-quality diagnosis — CLI wrapper.
 *
 * Implementation lives in lib/parking-quality-diagnose.ts so that Vercel's
 * serverless bundler can pull it into pages/api/cron/parking-quality-daily.ts
 * (Next.js does not bundle code outside the app tree).
 *
 * Run:
 *   node -r dotenv/config node_modules/.bin/tsx scripts/parking-quality-diagnose.ts dotenv_config_path=.env.local [hours=24]
 */

import { diagnose } from '../lib/parking-quality-diagnose';

export {
  diagnose,
  type DiagnosisReport,
  type UserSummary,
  type ClassifiedRow,
  type FailureSignature,
} from '../lib/parking-quality-diagnose';

if (require.main === module) {
  const hours = Number(process.argv.find(a => /^hours=/.test(a))?.split('=')[1]) || 24;
  diagnose(hours)
    .then(r => { console.log(JSON.stringify(r, null, 2)); })
    .catch(e => { console.error(e); process.exit(1); });
}
