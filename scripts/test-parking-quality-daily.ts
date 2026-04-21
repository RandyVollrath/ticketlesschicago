#!/usr/bin/env npx tsx
/**
 * Run the daily personalized parking-quality email handler end-to-end.
 * Sends a real email (when RESEND_API_KEY + ANTHROPIC_API_KEY are set).
 */

import handler from '../pages/api/cron/parking-quality-daily';

async function main() {
  const req = { headers: { 'x-vercel-cron': '1', authorization: '' } } as any;
  let status = 0;
  let body: any = null;
  const res = {
    status(s: number) { status = s; return res; },
    json(b: any) { body = b; return res; },
  } as any;
  await handler(req, res);
  console.log('HTTP status:', status);
  console.log(JSON.stringify(body, null, 2));
  if (status !== 200) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
