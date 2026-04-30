/**
 * Smoke test for the notification body guard.
 *
 * Run: NODE_ENV=test npx tsx scripts/smoke-test-notification-body-guard.ts
 *
 * Each assertion exercises a real bug pattern we've shipped to production
 * before. The guard exists to catch all of them at the moment of send.
 */

process.env.NODE_ENV = 'test';

import { checkNotificationBody, assertSafeNotificationBody } from '../lib/notification-body-guard';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('checkNotificationBody — accepts well-formed messages');
{
  const r = checkNotificationBody({ title: 'Ticket dismissed!', body: 'You saved $80.' });
  assert('plain push body passes', r.ok);
}
{
  const r = checkNotificationBody({ subject: 'Welcome', body: 'Hi Randy, welcome.' });
  assert('plain email passes', r.ok);
}
{
  const r = checkNotificationBody({ body: 'Customer named Null Island registered' });
  assert('substring "Null" in word does not false-positive', r.ok, r.reason);
}
{
  const r = checkNotificationBody({ body: 'Test undefinedfoo continued' });
  assert('"undefinedfoo" (no word boundary) does not false-positive', r.ok, r.reason);
}

console.log('\ncheckNotificationBody — rejects rendered garbage (real shipped bugs)');
{
  // Real bug: topQuestion.question vs .text rendered "undefined Reply to email…"
  const r = checkNotificationBody({ body: 'undefined Reply to email to confirm' });
  assert('blocks "undefined Reply to email…" (real shipped bug)', !r.ok && r.matched === 'undefined');
}
{
  // Real bug: NaN% in LLM prompt
  const r = checkNotificationBody({ body: 'Officer dismissed NaN% of similar tickets' });
  assert('blocks "$NaN" / "NaN%" rendering', !r.ok && r.matched === 'NaN');
}
{
  // Real bug: SMS body just "null"
  const r = checkNotificationBody({ body: 'Your missing item: null' });
  assert('blocks trailing literal "null"', !r.ok && r.matched === 'null');
}
{
  const r = checkNotificationBody({ title: 'undefined', body: 'ok body' });
  assert('blocks "undefined" in title', !r.ok && r.reason?.includes('title'));
}
{
  const r = checkNotificationBody({ subject: '', body: 'ok body' });
  assert('blocks empty subject', !r.ok && r.reason?.includes('subject'));
}
{
  const r = checkNotificationBody({ body: '   ' });
  assert('blocks whitespace-only body', !r.ok && r.reason?.includes('body'));
}
{
  const r = checkNotificationBody({ body: '' });
  assert('blocks empty body', !r.ok);
}

console.log('\nassertSafeNotificationBody — throws in dev/test on garbage');
{
  let threw = false;
  try {
    assertSafeNotificationBody({ body: 'undefined Reply to email' }, { channel: 'push', recipient: 'fake' });
  } catch {
    threw = true;
  }
  assert('throws in non-prod when body fails check', threw);
}
{
  // Should not throw when body is fine
  let threw = false;
  try {
    const ok = assertSafeNotificationBody({ body: 'You saved $80.' }, { channel: 'email', recipient: 'a@b.c' });
    if (!ok) threw = true;
  } catch {
    threw = true;
  }
  assert('does not throw on safe body', !threw);
}

console.log('\nassertSafeNotificationBody — prod skips send instead of throwing');
{
  process.env.NODE_ENV = 'production';
  const original = console.error;
  let logged = '';
  console.error = (msg: any) => { logged = String(msg); };
  try {
    const ok = assertSafeNotificationBody(
      { body: 'undefined Reply to email' },
      { channel: 'push', recipient: 'fake-token' }
    );
    assert('returns false (skip send) instead of throwing in prod', ok === false);
    assert('logs an error including channel + recipient', logged.includes('push') && logged.includes('fake-token'));
  } finally {
    console.error = original;
    process.env.NODE_ENV = 'test';
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
