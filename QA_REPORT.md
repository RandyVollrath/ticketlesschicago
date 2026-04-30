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
| Notification body guard | Refuses to send any push/SMS/email whose rendered body contains literal "undefined", "null", "NaN", or is empty | `lib/notification-body-guard.ts`, smoke at `scripts/smoke-test-notification-body-guard.ts` (15 assertions, run via `npm run qa:body-guard`) |
| Nightly Supabase types regen | Auto-PR every morning if the live schema drifted from `lib/database.types.ts`. Requires `SUPABASE_ACCESS_TOKEN` repo secret + repo setting "Allow GitHub Actions to create and approve pull requests" | `.github/workflows/types-regen.yml` |
| `verify-everything` | Branch-scoped ship gate (per CLAUDE.md, "must pass before claiming deployed") | `scripts/verify-everything.ts` (when present) |
| Ship rules in CLAUDE.md | "I saw it work" not "I think it works." Probe → live smoke → end-to-end → honest ledger | [CLAUDE.md](./CLAUDE.md#review-your-own-work-before-shipping--i-saw-it-work-not-i-think-it-works) |

## Holes (the proposed nets)

These are listed in priority order — top is highest leverage.

### 1. Nightly Supabase schema regenerate + commit ✅ SHIPPED 2026-04-29
**Catches:** schema drift. The single biggest source of bugs we've seen.
**How:** `.github/workflows/types-regen.yml` runs daily at 09:00 UTC. Calls `supabase gen types typescript --project-id dzhqolbhuqdcpngdayuq --schema public > lib/database.types.ts` and opens a PR via `peter-evans/create-pull-request` if the file changed. Once merged, every caller of a renamed/dropped column turns into a `tsc` error.
**Status:** workflow live. Verified on 2026-04-29: token works, ran successfully, detected 156 lines of real schema drift on first run.
**Pre-req:** repo secret `SUPABASE_ACCESS_TOKEN` (Personal Access Token from supabase.com/dashboard/account/tokens) AND repo setting "Allow GitHub Actions to create and approve pull requests" enabled.
**Local:** `npm run types:regen`.

### 2. Notification body `"undefined"` / empty guard ✅ SHIPPED 2026-04-29
**Catches:** silent string corruption. Every customer-facing message that interpolates a field — push, SMS, email — is sanity-checked at the moment of send.
**How:** `lib/notification-body-guard.ts` exposes `assertSafeNotificationBody(parts, context)`. Wired into `sendPushNotification` (firebase-admin), `sendClickSendSMS` (sms-service), and `sendEmailWithRetry` (resend-with-retry). Looks for the literal tokens `undefined`, `null`, `NaN` as standalone words plus empty/whitespace-only required fields. Word-boundary regex so customer last-name "Null" doesn't false-positive.
**Behavior:** in dev/test throws (loud); in prod logs at error level and returns `{success: false}` from the sender — we skip sending rather than send garbage.
**Smoke:** `npm run qa:body-guard` — 15 assertions covering every real shipped pattern (`undefined Reply to email`, `NaN%`, trailing `null`, empty subject, etc.).

### 3. Synthetic end-to-end monitor ✅ SHIPPED 2026-04-29
**Catches:** anything that breaks for a real user that no per-file test covers. Already paid for itself: caught two production bugs on the first run (see "Bugs caught by nets" below).
**How:** `scripts/smoke-test-contest-pipeline.ts` runs as the QA bot. Inserts a synthetic `monitored_plates` + `detected_tickets` + `portal_check_results` row, calls `detectOutcomeChange` and `processOutcomeChange` with a "Not Liable" disposition, asserts every customer-visible side effect (status → `won`, last_portal_status → dismissed, audit log, contest_outcomes row, notification_logs email row), then cleans up.
**Schedule:** `.github/workflows/qa-pipeline.yml` — daily at 12:00 UTC, plus on every push that touches contest-tracker code. Required secrets: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `QA_BOT_EMAIL`.
**Local:** `npm run qa:contest-pipeline`.

### 4. Clear the 587 → 0 TypeScript errors and gate deploys (HIGH leverage, MEDIUM-HIGH effort)
**Catches:** the always-false / always-null / wrong-shape family of bugs.
**Current:** ~530 errors in the repo, growing. Most are real (schema drift, structural drift), but the noise floor lets new errors sneak in unnoticed.
**How:** triage in batches; either fix the bug or `@ts-expect-error` with a comment explaining why; once at zero, add `npx tsc --noEmit` as a hard gate inside `npm run deploy`.
**Why this works:** the `autoSlice` array bug, the `userId` array bug, the Json-narrowing bugs were all already showing up as TS errors — we just couldn't see them because of the noise.
**Effort:** multi-day, but pays for itself quickly. Can be done incrementally per-file.

### 5. Lock SDK versions + Renovate ✅ SHIPPED 2026-04-29
**Catches:** SDK version drift before it goes live.
**How:** the eight historically-fragile SDKs are pinned exact (no `^`) in `package.json`: stripe, @stripe/react-stripe-js, @stripe/stripe-js, @vercel/blob, @simplewebauthn/{browser,server}, @supabase/{supabase-js,ssr,auth-helpers-nextjs}, firebase-admin, resend, @anthropic-ai/sdk. `renovate.json` opens one PR per upgrade for these, never auto-merged, with a warning note in the body. Patch/minor dev dependencies auto-merge. Pre-req: install Renovate from https://github.com/marketplace/renovate.

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

### 7. Portal-scraper canary ✅ SHIPPED 2026-04-29
**Catches:** the day the city changes their portal HTML or disposition wording — without it we'd silently miss every win.
**How:** `scripts/smoke-test-portal-canary.ts` is a pure-fixture test of `detectOutcomeChange`. 10 fixtures cover every wording we have ever seen the city use for "dismissed" / "upheld" / "reduced" / "hearing scheduled" / no-change. Runs daily inside the same `qa-pipeline.yml` workflow. No DB or env vars required.
**Local:** `npm run qa:portal-canary`.

### Bugs caught by nets (real shipped runtime bugs)
The synthetic monitor (#3) caught two production bugs on its first run on 2026-04-29:
1. **`processOutcomeChange` was writing `contest_outcome`/`contest_outcome_at`/`final_amount` to `detected_tickets`** but those columns live on `contest_letters`. The mismatch failed the entire UPDATE — meaning `status: 'won'` never persisted either. Every dismissal in production was leaving the ticket stuck in `mailed`. Fix: removed the wrong-table fields from the update; only write `status` / `last_portal_status` / `last_portal_check` to `detected_tickets`.
2. **`detected_tickets.status` CHECK constraint rejected the values the code wrote** (`won`, `lost`, `reduced`, `hearing_scheduled`, `contested_online`). Same failure: status never flipped. Fix: migration `20260429_expand_detected_tickets_status_check.sql` expands the allowed set. **Pending: apply this migration on prod via Supabase SQL editor.**

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
