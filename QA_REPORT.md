# QA & Reliability Report

**Last updated:** 2026-04-29

This document is the source of truth for how we catch bugs before they reach customers, what holes still exist, and which reliability work is queued. Update it every time we add or remove a net.

## Why this exists

Across late-April 2026 we shipped 25+ real, customer-impacting bugs in three days. Every one *compiled cleanly* — type-check, build, deploy all green. The bugs all fell into a small number of repeating shapes:

1. **Schema drift.** Code references columns that have been renamed/dropped (`address`, `evidence_deadline`, `mail_service_payment_status`, `lob_mail_id`, `mail_status`, etc.).
2. **SDK version drift.** A package upgrade silently changes a default or a field name. Examples: Vercel Blob v2 dropped `'private'` access *and* changed `addRandomSuffix` default to `false`; SimpleWebAuthn v13 nested credentials; Resend `replyTo` vs `reply_to`; Stripe API version pinning across files; PostHog `capture_pageview` (singular).
3. **Silent string corruption.** Code emits `"undefined"` or empty into a notification body. Customer-facing copy says `"undefined Reply to email…"`.
4. **Always-false / always-null logic.** A type coercion bug makes a comparison always false (the `fields.autoSlice` array vs string fix), a missing field in a `.select()` makes a check always null (the `evidence_deadline` fix), a Json-typed value isn't narrowed (the `notification_preferences` fix).

These will keep happening unless we put nets in place. **The current state is mostly: ship, hope, get bug report.** Below is what we have and what we need.

## Current nets (working)

| Net | What it catches | Where |
|---|---|---|
| Reliability release gate | Blocks deploy if recent prod errors exceed threshold | `scripts/reliability-release-gate.js` |
| CSP static check | Catches CSP regressions before deploy | `scripts/qa-csp-static.ts` |
| Auth smoke | End-to-end sign-in flow against prod after deploy | `scripts/qa-auth-smoke.ts`, runs as part of `npm run deploy` |
| Places geocoder smoke | 22 assertions covering Fullerton/Sheffield/Lakewood/Evanston | `scripts/smoke-test-places-geocoder.ts` |
| `verify-everything` | Branch-scoped ship gate (per CLAUDE.md, "must pass before claiming deployed") | `scripts/verify-everything.ts` (when present) |
| Ship rules in CLAUDE.md | "I saw it work" not "I think it works." Probe → live smoke → end-to-end → honest ledger | [CLAUDE.md](./CLAUDE.md#review-your-own-work-before-shipping--i-saw-it-work-not-i-think-it-works) |

## Holes (the proposed nets)

These are listed in priority order — top is highest leverage.

### 1. Nightly Supabase schema regenerate + commit (HIGH leverage)
**Catches:** schema drift. The single biggest source of bugs we've seen.
**How:** GitHub Action runs `supabase gen types typescript --project-id dzhqolbhuqdcpngdayuq > lib/database.types.ts` once a day and opens a PR if the file changes. Our typed Supabase client then surfaces every column rename or drop as a TypeScript error in the next morning's `npx tsc --noEmit`.
**Why this works:** the bugs we found this week (`evidence_deadline` missing from select, `address` vs `home_address_full`, `mail_service_payment_status` referenced but doesn't exist, `lob_mail_id`, etc.) all become errors immediately when types are fresh.
**Effort:** ~1 hour. Existing `lib/database.types.ts` regeneration is already supported by the Supabase CLI.

### 2. Notification body `"undefined"` / empty guard (HIGH leverage, LOW effort)
**Catches:** silent string corruption. Every customer-facing message that interpolates a field — push, SMS, email, voice prompt — gets sanity-checked.
**How:** thin wrapper around `sendPush` / `sendSMS` / `sendEmail` that throws if the rendered body contains the literal string `"undefined"`, `"null"`, `"NaN"`, or is empty. In dev it's a 500; in prod it logs to Sentry/PostHog and fails closed (we'd rather not send than send garbage).
**Why this works:** the `topQuestion.question` → `topQuestion.text` bug, the renewal-profile SMS that didn't tell users what was missing, and the LLM "undefined/undefined dismissed (NaN%)" prompt would all have been caught before sending.
**Effort:** 30 minutes.

### 3. Synthetic end-to-end monitor (HIGH leverage, MEDIUM effort)
**Catches:** anything that breaks for a real user, including the bugs the type checker can't see.
**How:** scheduled cron (Vercel cron or systemd timer) once a day runs a script that pretends to be a real user end-to-end:
  - Sign up a test account → checkout → user_profile created
  - Upload a fake ticket (or insert into `detected_tickets`)
  - Trigger contest letter generation
  - Simulate a portal "dismissed" outcome
  - Confirm win-notification fires and the user record updates
**Why this works:** today we have one smoke test (places-geocoder, 22 assertions). Most user paths have zero. A synthetic run catches whole-flow breakage that no per-file test covers.
**Effort:** ~half a day for the first one, ~1 hour each for additional flows.

### 4. Clear the 587 → 0 TypeScript errors and gate deploys (HIGH leverage, MEDIUM-HIGH effort)
**Catches:** the always-false / always-null / wrong-shape family of bugs.
**Current:** ~530 errors in the repo, growing. Most are real (schema drift, structural drift), but the noise floor lets new errors sneak in unnoticed.
**How:** triage in batches; either fix the bug or `@ts-expect-error` with a comment explaining why; once at zero, add `npx tsc --noEmit` as a hard gate inside `npm run deploy`.
**Why this works:** the `autoSlice` array bug, the `userId` array bug, the Json-narrowing bugs were all already showing up as TS errors — we just couldn't see them because of the noise.
**Effort:** multi-day, but pays for itself quickly. Can be done incrementally per-file.

### 5. Lock SDK versions + Renovate (MEDIUM leverage, LOW effort)
**Catches:** SDK version drift before it goes live.
**How:** drop `^` and `~` prefixes in `package.json` so `npm install` doesn't bump anything. Add Renovate (or Dependabot) to open one PR per upgrade with the diff visible. Each upgrade gets read and tested instead of silently merging.
**Why this works:** Vercel Blob v2 dropping `'private'`, SimpleWebAuthn v13's nested credential, and Resend's `replyTo` rename would all have been a single visible PR each, caught at review time instead of in production.
**Effort:** 1 hour to lock versions + add Renovate config.

### 6. Smoke tests for the remaining critical user paths (MEDIUM leverage, MEDIUM effort)
**Catches:** breakage on flows we don't currently exercise after each deploy.
**Current:** we have the places-geocoder smoke (22 assertions) and an auth smoke. We need:
  - Checkout flow (Stripe → user_profile + autopilot_subscriptions + monitored_plates + welcome email)
  - Contest-letter generation (has the foiaData/courtData rename bug been caught? does it still produce a valid letter?)
  - Video upload + auto-slice (regression test for the `autoSlice` fix)
  - Mail-letter payment (regression test for the `extracted_data` wipe fix)
  - FOIA email parsing (incoming Resend webhook → FOIA history match)
  - Push notification body (regression test for `topQuestion.question` and similar)
  - Portal scraper output → outcome detection (regression test for "Not Liable" / "Liable" text matching)
**Effort:** ~1 hour per smoke test.

### 7. Portal-scraper canary (MEDIUM leverage, LOW effort)
**Catches:** the day the city changes their portal HTML or disposition wording — without it, we'd silently miss every win.
**How:** maintain a small list of known-historical tickets with known dispositions. Once a week the scraper re-runs against them and asserts the parser still recognizes "Not Liable" → dismissed, "Liable" → upheld, etc. If the city ever changes wording we know within a week instead of "we never knew we were missing wins."
**Effort:** 1 hour.

## Bug taxonomy (last 30 days)

| Bucket | Count | Example |
|---|---|---|
| Schema drift | ~10 | `evidence_deadline` not in select; `address` vs `home_address_full`; `mail_service_payment_status` doesn't exist |
| SDK drift | ~5 | Vercel Blob `'private'` no-op; SimpleWebAuthn v13 nesting; Resend `replyTo`; Stripe API version |
| Silent string corruption | ~3 | "undefined Reply to email"; permit-renewal SMS missing what's missing; LLM "undefined/undefined dismissed (NaN%)" |
| Always-false / always-null | ~5 | `fields.autoSlice` array vs string; `userId` array; `notification_preferences` Json without narrowing; `extracted_data` spread of undefined |
| Logic / variable scope | ~2 | `user.id` undefined in winter-ban path; `simulatePreparation` undefined |
| **Total** | ~25 | |

## Notification audit log

What we *do* send to customers (and to admin) and where it's wired:

| Trigger | Channel | Recipient | Source |
|---|---|---|---|
| Contest outcome detected | Push notification | User | `lib/contest-outcome-tracker.ts:notifyUserOfOutcome` |
| Contest outcome detected | Email | **Admin** (`getAdminAlertEmails()`) | `lib/contest-outcome-tracker.ts:notifyAdminOfOutcome` ✅ added 2026-04-29 |
| New paid signup | Email | **Admin** (`getAdminAlertEmails()`) | `pages/api/stripe-webhook.ts` (checkout.session.completed) ✅ added 2026-04-29 |
| First eContest attempt | Email | Admin | `pages/api/cron/autopilot-mail-letters.ts:188` |
| FOIA history matched | Email | Admin | `pages/api/webhooks/resend-incoming-email.ts` |
| Tow detected | Push notification | User | `pages/api/cron/check-towed-vehicles.ts` |
| Renewal due | SMS / email | User | `pages/api/cron/notify-renewal-profile-confirmation.ts` |

The single env var `ADMIN_ALERT_EMAILS` (comma-separated) controls all admin recipients via `lib/admin-alert-emails.ts`. Default fallback: `randyvollrath@gmail.com`.

## Maintenance

- Update this doc whenever a net is added, removed, or substantially changed.
- When a customer-impacting bug ships to prod, add a row to the taxonomy and ask: would any net on this list have caught it? If yes, that's a vote to prioritize that net. If no, that's a vote to add a new net.
