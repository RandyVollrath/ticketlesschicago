#!/usr/bin/env npx tsx
/**
 * QA: Static CSP check (Option 1 from the auth-QA plan).
 *
 * Parses next.config.mjs's Content-Security-Policy and asserts that
 * connect-src includes every host the browser needs to reach. Catches
 * the exact bug we shipped earlier today: NEXT_PUBLIC_SUPABASE_URL
 * pointed at the Supabase custom domain (auth.autopilotamerica.com) but
 * connect-src only allowed *.supabase.co, silently breaking Google
 * sign-in after redirect.
 *
 * Runs in under a second. Wired into `npm run deploy` so it blocks
 * deploys before CSP drift can reach prod.
 *
 * Run: npm run qa:csp
 */

import * as fs from 'fs';
import * as path from 'path';

// Hosts the browser MUST be able to reach. If a service is added to the
// stack or a custom domain changes, update this list AND the CSP in
// next.config.mjs at the same time.
const REQUIRED_CONNECT_SRC: { pattern: RegExp; label: string }[] = [
  { pattern: /https:\/\/\*\.supabase\.co\b/, label: 'Supabase project-ref host (*.supabase.co)' },
  { pattern: /https:\/\/auth\.autopilotamerica\.com\b/, label: 'Supabase custom auth domain' },
  { pattern: /https:\/\/api\.stripe\.com\b/, label: 'Stripe API' },
  { pattern: /https:\/\/\*\.posthog\.com\b/, label: 'PostHog' },
  { pattern: /https:\/\/\*\.sentry\.io\b/, label: 'Sentry' },
  { pattern: /https:\/\/api\.resend\.com\b/, label: 'Resend' },
  { pattern: /https:\/\/maps\.googleapis\.com\b/, label: 'Google Maps' },
  { pattern: /https:\/\/r\.wdfl\.co\b/, label: 'Rewardful' },
];

function extractConnectSrc(configSource: string): string | null {
  // next.config.mjs stores the policy as a quoted string; pull out the
  // connect-src segment regardless of its position in the array.
  const m = configSource.match(/"connect-src ([^"]+)"/);
  return m ? m[1] : null;
}

function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function main(): void {
  const configPath = path.join(process.cwd(), 'next.config.mjs');

  let configSource: string;
  try {
    configSource = fs.readFileSync(configPath, 'utf-8');
  } catch (err: any) {
    console.error(`❌ Could not read ${configPath}: ${err.message}`);
    process.exit(1);
  }

  const connectSrc = extractConnectSrc(configSource);
  const failures: string[] = [];

  if (!connectSrc) {
    failures.push('Could not find connect-src directive in next.config.mjs');
  } else {
    for (const req of REQUIRED_CONNECT_SRC) {
      if (!req.pattern.test(connectSrc)) {
        failures.push(`connect-src missing ${req.label} (expected pattern: ${req.pattern})`);
      }
    }

    // Drift guard: if NEXT_PUBLIC_SUPABASE_URL is set (locally via
    // .env.local or in CI via repo secrets), its host MUST appear in
    // connect-src. This catches the case where someone changes the
    // Supabase custom domain without updating CSP.
    const supaHost = hostFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (supaHost) {
      const isDefaultSupabase = supaHost.endsWith('.supabase.co');
      const isInCsp = connectSrc.includes(`https://${supaHost}`);
      if (!isDefaultSupabase && !isInCsp) {
        failures.push(
          `NEXT_PUBLIC_SUPABASE_URL host "${supaHost}" is not listed in connect-src. ` +
          `Add "https://${supaHost}" (and the wss:// variant for realtime).`
        );
      }
    }
  }

  if (failures.length === 0) {
    console.log('✅ CSP static check passed');
    console.log('   connect-src includes all required hosts.');
    process.exit(0);
  }

  console.error('❌ CSP static check FAILED');
  for (const f of failures) console.error(`   - ${f}`);
  console.error('\n   Fix: edit the connect-src line in next.config.mjs to include the missing host(s).');
  process.exit(1);
}

main();
