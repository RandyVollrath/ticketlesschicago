/**
 * Notification body guard — Reliability net #2 (QA_REPORT.md).
 *
 * The single biggest source of customer-visible breakage in this codebase has
 * been *silent string corruption*: a field rendered as the literal text
 * "undefined" (e.g. "undefined Reply to email…"), a final amount of "$NaN", or
 * a body that's just an empty string. The data layer happily accepts garbage
 * and the customer reads it.
 *
 * This guard runs right before a notification leaves the system. If the
 * rendered body looks like garbage we fail closed:
 *   - in dev/test: throw, so the bug surfaces in unit tests / local dev.
 *   - in prod: log a high-priority warning and return a "blocked" result so
 *     the caller can decide whether to fall back or skip. We do NOT send.
 *
 * Use it from every sender (push, SMS, email, voice) at the moment we have
 * the final rendered text in hand.
 */

const FORBIDDEN_MARKERS = ['undefined', 'null', 'NaN'];

export interface BodyCheckResult {
  ok: boolean;
  reason?: string;
  matched?: string;
}

/**
 * Strict check used by senders. Looks for the literal substring "undefined",
 * "null", or "NaN" in any of the supplied fields, plus empty/whitespace-only
 * required fields. Case-sensitive on purpose — "Null Island" is fine,
 * "undefined" as a word inside a sentence is not (no real notification body
 * ever contains the literal word "undefined").
 *
 * Pass any subset of (title, body, subject) — only the supplied fields are
 * checked. Each field is checked independently so the error message tells you
 * which one is broken.
 */
export function checkNotificationBody(parts: {
  title?: string;
  body?: string;
  subject?: string;
}): BodyCheckResult {
  const fields: { name: string; required: boolean; value: string | undefined }[] = [
    { name: 'title', required: parts.title !== undefined, value: parts.title },
    { name: 'subject', required: parts.subject !== undefined, value: parts.subject },
    { name: 'body', required: true, value: parts.body },
  ].filter(f => f.value !== undefined || f.required);

  for (const field of fields) {
    const value = field.value;

    if (field.required && (!value || !value.trim())) {
      return {
        ok: false,
        reason: `notification ${field.name} is empty`,
      };
    }
    if (!value) continue;

    // Look for forbidden markers as standalone words. Word-boundary regex so
    // "undefined" inside "undefinedfoo" doesn't false-positive (it shouldn't
    // happen but be defensive). Case-sensitive on purpose: a customer's last
    // name "Null" should not block their notification.
    for (const marker of FORBIDDEN_MARKERS) {
      const re = new RegExp(`(^|[^A-Za-z0-9_])${marker}([^A-Za-z0-9_]|$)`);
      if (re.test(value)) {
        return {
          ok: false,
          reason: `notification ${field.name} contains literal "${marker}"`,
          matched: marker,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * For senders. Throws in dev/test, logs+returns in prod. Caller decides
 * whether to abort the send (recommended) or proceed anyway with a fallback
 * value.
 *
 * @returns true if the body is safe to send, false if it should be blocked.
 */
export function assertSafeNotificationBody(
  parts: { title?: string; body?: string; subject?: string },
  context: { channel: 'push' | 'sms' | 'email' | 'voice'; recipient?: string }
): boolean {
  const result = checkNotificationBody(parts);
  if (result.ok) return true;

  const msg = `[notification-body-guard] BLOCKED ${context.channel} send to ${context.recipient || 'unknown'} — ${result.reason}. Title=${JSON.stringify(parts.title)} Subject=${JSON.stringify(parts.subject)} Body=${JSON.stringify(parts.body?.slice(0, 200))}`;

  if (process.env.NODE_ENV !== 'production' && (process.env.NODE_ENV as string) !== 'staging') {
    // Dev/test: fail loudly so the bug surfaces during development.
    throw new Error(msg);
  }

  // Prod: log at error level so it shows up in monitoring, then return false
  // and let the caller skip the send. Better to send nothing than send "$NaN".
  console.error(msg);
  return false;
}
