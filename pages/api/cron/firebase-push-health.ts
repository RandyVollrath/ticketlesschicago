/**
 * Cron Job: Firebase push notification health check
 *
 * Runs daily. Sends a push to a deliberately-invalid FCM token to exercise
 * the auth + send round-trip without bothering any real device.
 *
 * Three things we care about distinguishing:
 *   ✓ HEALTHY — Firebase auth succeeds, token rejected as invalid (our fake)
 *   ✗ AUTH BROKEN — invalid_grant / DECODER / OpenSSL → fires Resend alert
 *   ✗ NOT CONFIGURED — env var missing → fires Resend alert
 *
 * The motivation: from <unknown date> until 2026-04-28, FIREBASE_CLIENT_EMAIL
 * was set to a personal Gmail. Every push silently failed at Google's auth
 * step with "invalid_grant: account not found". Nothing in the cron's response
 * surfaced this — counters were all zero, no `errors` bump, no DB mutation.
 * Users (including paid) never received a single street-cleaning, winter-ban,
 * permit-zone, DOT-permit, snow-route, sweeper-passed, meter, or sticker push.
 * This cron exists to make sure that NEVER happens again silently.
 *
 * Schedule: 12:00 UTC daily (~7am Chicago, before the morning meter/cleaning
 * pushes go out).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sendPushNotification, isFirebaseConfigured } from '../../../lib/firebase-admin';
import { Resend } from 'resend';

const FAKE_TOKEN =
  'health_check_known_invalid_token_dGhpcyBpcyBub3QgYSByZWFsIHRva2VuIGl0J3MgYSBoZWFsdGggY2hlY2sgaGV5IGZpcmViYXNl';

// Errors that mean "Firebase auth itself is broken" — these fire the alert.
// Token-validation errors are NORMAL and mean Firebase is healthy.
const AUTH_FAILURE_PATTERNS = [
  /invalid_grant/i,
  /account not found/i,
  /DECODER routines::unsupported/i,
  /Failed to fetch a valid Google OAuth2 access token/i,
  /invalid_client/i,
  /unauthorized_client/i,
];

// Errors that mean "auth worked, our test token is just bogus" — these are
// the HEALTHY signal. We treat anything matching as confirmation.
const TOKEN_VALIDATION_PATTERNS = [
  /not a valid FCM registration token/i,
  /messaging\/invalid-registration-token/i,
  /messaging\/registration-token-not-registered/i,
  /messaging\/invalid-argument/i,
];

async function alertOps(subject: string, body: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'noreply@autopilotamerica.com';
  const to = (process.env.ADMIN_ALERT_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!apiKey || to.length === 0) {
    console.error('[firebase-health] Cannot send alert — RESEND_API_KEY or ADMIN_ALERT_EMAILS missing');
    return;
  }
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to,
      subject: `[ALERT] ${subject}`,
      text: body,
    });
    console.error(`[firebase-health] Alert email sent to ${to.join(', ')}`);
  } catch (err) {
    console.error('[firebase-health] Failed to send Resend alert:', err);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  if (!isFirebaseConfigured()) {
    const msg =
      'Firebase Admin SDK is not configured in production. ' +
      'FIREBASE_PRIVATE_KEY is missing or invalid. ' +
      'NO push notifications can be delivered until this is fixed. ' +
      'Generate a fresh service-account JSON at ' +
      'https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk ' +
      'and paste the entire JSON into the FIREBASE_PRIVATE_KEY env var on Vercel.';
    console.error(`[firebase-health] ${msg}`);
    await alertOps('Firebase push not configured', msg);
    return res.status(500).json({ status: 'not_configured', message: msg });
  }

  const result = await sendPushNotification(FAKE_TOKEN, {
    title: '[health-check] DO NOT DELIVER',
    body: 'Firebase push round-trip health check — uses a deliberately-invalid token.',
    data: { type: 'health_check' },
  });

  // Healthy path: send "failed" with a token-validation error message.
  if (!result.success && result.error) {
    if (TOKEN_VALIDATION_PATTERNS.some(re => re.test(result.error!))) {
      console.log(`[firebase-health] HEALTHY — Firebase auth round-trip OK (got expected token rejection: ${result.error})`);
      return res.status(200).json({ status: 'healthy', expectedError: result.error });
    }
    if (AUTH_FAILURE_PATTERNS.some(re => re.test(result.error!))) {
      const msg =
        `Firebase push notifications are BROKEN at the auth layer.\n\n` +
        `Error: ${result.error}\n\n` +
        `Effect: every push attempt — meter expiry, street cleaning, winter ban, permit zone, ` +
        `DOT permit, snow route, sweeper-passed, city sticker, license plate sticker — is being ` +
        `rejected by Google before it reaches any device.\n\n` +
        `Likely cause: FIREBASE_PRIVATE_KEY env var has been rotated/revoked, OR a sibling env ` +
        `var (FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID) is overriding the JSON with a wrong ` +
        `value. Check https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk ` +
        `and replace FIREBASE_PRIVATE_KEY in Vercel with the full service-account JSON.`;
      console.error(`[firebase-health] AUTH BROKEN: ${result.error}`);
      await alertOps('Firebase push auth broken — no notifications delivering', msg);
      return res.status(500).json({ status: 'auth_broken', error: result.error });
    }
    // Unknown error — alert as a precaution
    console.error(`[firebase-health] UNKNOWN error: ${result.error}`);
    await alertOps('Firebase push health check returned unknown error', result.error);
    return res.status(500).json({ status: 'unknown_error', error: result.error });
  }

  // Unexpected: a fake token "succeeded". Almost certainly impossible, but
  // alert anyway since we no longer trust the signal.
  const msg = `Firebase push to a fake token reported success — should be impossible. result=${JSON.stringify(result)}`;
  console.error(`[firebase-health] UNEXPECTED: ${msg}`);
  await alertOps('Firebase push health check anomaly', msg);
  return res.status(500).json({ status: 'unexpected_success' });
}
