# Project Instructions

## Product Decisions — READ FIRST
See **[PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md)** for finalized product decisions. NEVER change behavior that contradicts that document without explicit owner approval.

## Codebase Overview
- **Web app**: Next.js (pages/), deployed to Vercel via push to `main`
- **Mobile app**: React Native in `TicketlessChicagoMobile/`, iOS + Android
- **Backend**: Supabase (auth, database, RLS policies)
- **Domain**: autopilotamerica.com

## Review your own work before shipping — "I saw it work," not "I think it works"

The precedent: in one session I shipped four external-data integrations and three were broken — wrong dataset IDs (a beach-swim-advisory dataset where I thought I had CDOT), wrong schemas (polygon assumption on an address-range dataset), a defense branch that falsely fired on every empty query. Each one **compiled cleanly**, each had a green TypeScript check, each had an encouraging subagent summary. Not one of them actually worked. Only the user pushing back caught it.

The failure mode was confusing **"compiles + a subagent says it works"** with **"I actually saw it work."** That is the single biggest trap and every rule below exists to prevent it.

### What counts as "I saw it work"
- You ran a real request against the real endpoint, looked at the actual response, and the shape + content were what you claimed.
- You ran a script against the production DB or real user flow and the assertion passed.
- You read the output yourself, not a summary of the output.

### What does NOT count as "I saw it work"
- TypeScript compiled.
- A subagent summary said the schema has `foo` and `bar`.
- Unit tests pass on fixtures you wrote yourself.
- The code "looks right" when you re-read it.
- You patched the same kind of bug before in a different file.

### Ship Rules — no task is "done" until:
1. **Probe before code.** Any external data integration (Open Data, CTA, city APIs, third-party services) starts with a live `curl` of the real endpoint to confirm the dataset exists, the schema matches expectation, and the most recent row is recent enough for the use case. Paste the probe output into the module's top-level comment or a companion smoke-test.
2. **Live smoke test is the acceptance criterion.** `npx tsc --noEmit` passing is NOT sufficient. For anything that touches external services, DB writes, or new user-facing output, there must be a script under `scripts/smoke-test-*.ts` that hits the real thing, that you ran, whose output you read, and whose exit code was 0.
3. **End-to-end when possible.** Before saying "shipped," ask: would this work for a real user right now, with a real ticket, today? If I only know it compiles, flag it as "awaiting real-world data" explicitly rather than claiming it's done.
4. **Subagent output is a draft, not a fact.** Any claim a subagent makes about a schema, dataset ID, API endpoint, or external field name is a hypothesis. Verify it with `curl` before coding against it. Never wire code to a claim you haven't personally checked.
5. **When in doubt, test it.** Running `curl` once is cheaper than shipping a broken defense into a user's letter.
6. **Honest ledger per ship.** For each commit, explicitly say what was verified live vs. what merely compiles or only passes pattern-match checks against source. Never claim more than was tested.
7. **If `scripts/verify-everything.ts` exists, it must pass** before you say anything is deployed. No exceptions.

## Explain things like I'm in fifth grade
When explaining what changed, what broke, or how a system works, use plain language and everyday analogies. Skip the jargon. Imagine you're telling a curious 10-year-old. Short sentences. No acronyms without spelling them out. If a concept needs a metaphor (door, permission slip, robot, file cabinet), use one.

This applies to end-of-turn summaries, bug diagnoses, and any "what did you do?" answers — not to code comments or commit messages, which stay precise and technical.

## Deployment — MANDATORY after every change
See **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** for full workflow. Summary:
1. Commit, push to GitHub
2. `npm run deploy` (web) — runs reliability gate + CSP static check + vercel prod + post-deploy auth smoke. **Use this instead of bare `npx vercel --prod --yes`** so the auth smoke catches regressions before customers do. If you need a fast path without gates, `npm run deploy:fast` still exists.
3. **Promote BOTH production aliases manually.** Vercel does NOT auto-promote `autopilotamerica.com` or `www.autopilotamerica.com` on this project — every deploy stays on its `*-randyvollraths-projects.vercel.app` URL until you alias it. After step 2 capture the new deploy URL and run BOTH:
   ```bash
   npx vercel alias set <deploy-url> autopilotamerica.com --scope randyvollraths-projects
   npx vercel alias set <deploy-url> www.autopilotamerica.com --scope randyvollraths-projects
   ```
   If you skip this, the code is "deployed" but no real user sees it. That has happened multiple times — it is the #1 way work silently fails.
4. **Verify the change is actually live.** Curl the affected endpoint on `www.autopilotamerica.com` (apex 307s to www) and confirm the response reflects the new code. If it's a UI change, hit the page and grep for the new copy/component. Pasting the curl output (or "I saw X in the response") into the end-of-turn message is required — don't say "shipped" without it. Example after a find-section change:
   ```bash
   curl -sS 'https://www.autopilotamerica.com/api/find-section?address=...' | python3 -m json.tool | head
   ```
5. `./gradlew assembleRelease` → adb install → Firebase App Distribution upload (Android)
6. iOS: user builds locally via Xcode
7. **Task is NOT complete until deployed, aliased, verified live, and URL reported.** "It compiled," "it deployed," and "the alias was set" are three different things. Don't conflate them.
8. No dirty working tree at handoff

**NEVER ask "deploy now?" — just deploy.** If a code change ships, deployment is part of the change. Asking for permission to deploy wastes the user's time. The only exception is if the user has explicitly said "don't deploy yet" in this conversation.

**NEVER claim something is "live" without curling the new alias and seeing the new behavior in the response.** "Saw it work" means saw the new response — not "the deploy succeeded."

Connected devices: Moto G 2025 (`ZT4224LFTZ`), Moto E5 Play (`ZY326L2GKG`)

## Detailed Reference Docs
Read these when working on the relevant subsystem:
- **[docs/PARKING_LOCATION_ACCURACY.md](./docs/PARKING_LOCATION_ACCURACY.md)** — **READ FIRST** before ANY parking location changes. Failure modes, architecture, rules, change log
- **[docs/BLUETOOTH_DETECTION.md](./docs/BLUETOOTH_DETECTION.md)** — Android BT parking detection architecture, race conditions, foreground service rules
- **[docs/IOS_PARKING_DETECTION.md](./docs/IOS_PARKING_DETECTION.md)** — CoreMotion + GPS detection, CLVisit monitoring, recovery, GPS-only fallback
- **[docs/IOS_CAMERA_ALERTS.md](./docs/IOS_CAMERA_ALERTS.md)** — Native iOS camera alerts, background TTS, App Store compliance
- **[docs/WEBVIEW_RULES.md](./docs/WEBVIEW_RULES.md)** — iOS vs Android WebView differences, embedded page rules, cross-platform dev rules
- **[docs/PARKING_STATE_MACHINE.md](./docs/PARKING_STATE_MACHINE.md)** — State machine invariants, departure matching, manual vs auto-detect, address display
- **[docs/CAMERA_ALERTS_RULES.md](./docs/CAMERA_ALERTS_RULES.md)** — Camera alert reliability, settings sync chain
- **[CAMERA_ALERTS_RELIABILITY.md](./CAMERA_ALERTS_RELIABILITY.md)** — Full failure log and testing checklist

## Critical Rules (Always Apply)

### Website/App Copy — MUST be functionally true
Only add copy to the website, app, or any user-facing surface if it is **functionally true** — the product actually does what the copy claims, today, in the code. Before writing or editing any user-facing copy:
1. **Verify the claim against the code.** Read the relevant service/handler/cron job. Don't rely on memory or assumption.
2. **If the claim is not true**, do not write it. Tell the user explicitly, and offer to either (a) make the copy match reality, or (b) implement the feature so the copy becomes true.
3. **If a stat or number is involved** (FOIA data, win rates, revenue figures), query the source (e.g. `~/Documents/FOIA/foia.db`) and cite it. Never invent or estimate — per the "Never make up numbers" rule in memory.

This applies to marketing pages, onboarding flows, confirmation screens, email templates, and any text a user sees. Deceptive or aspirational copy erodes trust and creates legal exposure.

### Every feature must work on BOTH iOS and Android
Think through platform differences separately. iOS is stricter on almost everything. See [docs/WEBVIEW_RULES.md](./docs/WEBVIEW_RULES.md) for details.

### React State — NEVER default to empty when sync read exists
```typescript
// BAD
const [user, setUser] = useState<User | null>(null);
// GOOD
const [user, setUser] = useState<User | null>(AuthService.getUser());
```
Subscribe effects: `[]` dependency arrays, use refs for previous values.

### Camera Alerts — Default to ON
Every camera alert flag must default to **enabled**. Never add a `Platform.OS` guard that disables alerts on either platform. See [docs/CAMERA_ALERTS_RULES.md](./docs/CAMERA_ALERTS_RULES.md).

### `is_paid` Field — NEVER default to true
Only the Stripe webhook `checkout.session.completed` sets `is_paid: true`. Free signups are free.

### Manual "Check My Parking" — NEVER save to history
Only auto-detected parking saves to history. Manual checks use phone GPS (inaccurate). Both paths must update the state machine. See [docs/PARKING_STATE_MACHINE.md](./docs/PARKING_STATE_MACHINE.md).

### Address Display — NEVER show raw coordinates
Always show human-readable addresses. Use `isCoordinateAddress()` guard + `ClientReverseGeocoder.ts` fallback chain.

### Data Persistence
- Local-first (AsyncStorage), fire-and-forget sync to Supabase
- Never block UI waiting for server sync

## Supabase Details
- Project ref: `dzhqolbhuqdcpngdayuq`
- localStorage key: `sb-dzhqolbhuqdcpngdayuq-auth-token`
- RLS enabled on all tables — queries must include user_id filtering

## CHI PAY Portal Scraper
- `lib/chicago-portal-scraper.ts` — Playwright headless browser, bypasses hCaptcha (backend doesn't validate tokens)
- No CAPTCHA API keys needed, ~14s per plate
- Autopilot: Mon/Thu via systemd timers (`scripts/autopilot-check-portal.ts`)

## Parking Pipeline Health
- `BackgroundTaskService.ts` tracks consecutive failures + last success
- Persisted to AsyncStorage (`parking_pipeline_health_v1`)
- Warns after 3+ consecutive failures or 7+ days without success
- Every `triggerParkingCheck()` outcome MUST call `recordParkingCheckOutcome()`
