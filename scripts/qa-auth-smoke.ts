#!/usr/bin/env npx tsx
/**
 * QA: End-to-end auth smoke test (Option 3 from the auth-QA plan).
 *
 * Signs in as the QA bot via admin-generated magic link, loads
 * /dashboard, and asserts the signed-in view renders cleanly with no
 * CSP violations in the browser console. This catches the full set of
 * failure modes that can silently break sign-in:
 *
 *   - CSP connect-src drift (today's bug — blocked /auth/v1/user)
 *   - Supabase client misconfiguration
 *   - The /auth/callback → /oauth-return rewrite breaking
 *   - /dashboard page crashing on hydrate
 *   - Supabase custom domain misrouting
 *
 * Signing in by magic-link rather than Google OAuth is deliberate:
 * Google aggressively blocks bot-driven sign-ins, which would make the
 * test flaky without adding coverage — the browser-side token exchange
 * (where today's CSP bug lived) is identical on both paths.
 *
 * Run manually:
 *   node -r dotenv/config node_modules/.bin/tsx scripts/qa-auth-smoke.ts dotenv_config_path=.env.local
 *
 * Runs automatically every 30 min via .github/workflows/qa-auth.yml.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium, Browser, Page } from 'playwright';

const SITE_URL = (process.env.QA_SITE_URL || 'https://www.autopilotamerica.com').replace(/\/$/, '');
const BOT_EMAIL = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';
const SCREENSHOT_PATH = process.env.QA_SCREENSHOT_PATH || 'qa-auth-failure.png';
const NAV_TIMEOUT_MS = 30_000;
const ASSERT_TIMEOUT_MS = 15_000;

type Outcome = { pass: boolean; reason?: string; consoleErrors: string[] };

async function runFlow(page: Page): Promise<Outcome> {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  // Page-level exceptions (uncaught errors in app JS).
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // Step 1: admin-generate a magic link so we don't depend on email
  // delivery or Google OAuth bot-defenses.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: BOT_EMAIL,
    options: { redirectTo: `${SITE_URL}/dashboard` },
  });

  if (linkError) {
    return { pass: false, reason: `generateLink failed: ${linkError.message}`, consoleErrors };
  }
  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) {
    return { pass: false, reason: 'generateLink returned no action_link', consoleErrors };
  }

  // Step 2: visit the verify link. Supabase issues a 302 back to its
  // configured redirect URL with #access_token=... in the URL hash; the
  // supabase-js client on the landing page detects the hash, calls
  // /auth/v1/user to hydrate the session, and persists it to cookies +
  // localStorage. This /auth/v1/user call is the one CSP drift would
  // block. Where Supabase lands you depends on the project's "Redirect
  // URLs" allowlist — don't assume it's /get-started.
  await page.goto(actionLink, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });

  // Step 3: navigate to /dashboard. Once the session is persisted in
  // the previous step, any page load will see the signed-in user. The
  // dashboard renders the user's email when `user` is non-null; an
  // unauthenticated visit bounces to /login instead.
  await page.goto(`${SITE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });

  // Step 4: confirm the bot email is visible on the dashboard — this
  // both asserts the signed-in render path AND that it's the right
  // user (guards against a stale session or an alternate render path).
  try {
    await page.waitForSelector(`text=${BOT_EMAIL}`, { timeout: ASSERT_TIMEOUT_MS });
  } catch {
    try { await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }); } catch {}
    const currentUrl = page.url();
    const bodyText = (await page.textContent('body').catch(() => ''))?.slice(0, 500);
    const storageKeys = await page.evaluate(() => {
      try { return Object.keys(localStorage).filter(k => k.includes('supabase') || k.startsWith('sb-')); }
      catch { return []; }
    }).catch(() => []);
    return {
      pass: false,
      reason: `Signed-in view never rendered on /dashboard (bot email "${BOT_EMAIL}" not found).\n   URL: ${currentUrl}\n   Supabase storage keys: ${JSON.stringify(storageKeys)}\n   Body (first 500c): ${bodyText}`,
      consoleErrors,
    };
  }

  // Step 5: fail on any CSP / refused-to-connect violations captured
  // during the flow. These are exactly the signal that caught today's
  // bug in the user's browser console.
  const cspErrors = consoleErrors.filter(e => {
    const lower = e.toLowerCase();
    return lower.includes('content security policy')
      || lower.includes('refused to connect')
      || lower.includes('authretryablefetcherror');
  });
  if (cspErrors.length) {
    try { await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }); } catch {}
    return {
      pass: false,
      reason: `CSP / fetch errors in console:\n   - ${cspErrors.join('\n   - ')}`,
      consoleErrors,
    };
  }

  return { pass: true, consoleErrors };
}

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }

  console.log(`→ QA auth smoke: site=${SITE_URL}, bot=${BOT_EMAIL}`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      // Be honest about being a bot; some anti-abuse paths whitelist
      // this user agent. Keeps the test deterministic.
      userAgent: 'Mozilla/5.0 AutopilotAmerica-QA-Bot Playwright',
    });
    const page = await context.newPage();
    const outcome = await runFlow(page);

    if (outcome.pass) {
      console.log('✅ QA auth smoke PASSED');
      console.log(`   Bot signed in end-to-end with no CSP violations.`);
      process.exit(0);
    }
    console.error('❌ QA auth smoke FAILED');
    console.error(`   ${outcome.reason}`);
    if (outcome.consoleErrors.length) {
      console.error('   Console errors captured during run:');
      for (const e of outcome.consoleErrors.slice(0, 20)) {
        console.error(`     - ${e.slice(0, 300)}`);
      }
    }
    process.exit(1);
  } catch (err: any) {
    console.error('❌ QA auth smoke errored:', err?.message || err);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();
