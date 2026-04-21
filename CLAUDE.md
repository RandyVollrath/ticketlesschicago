# Project Instructions

## Product Decisions — READ FIRST
See **[PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md)** for finalized product decisions. NEVER change behavior that contradicts that document without explicit owner approval.

## Codebase Overview
- **Web app**: Next.js (pages/), deployed to Vercel via push to `main`
- **Mobile app**: React Native in `TicketlessChicagoMobile/`, iOS + Android
- **Backend**: Supabase (auth, database, RLS policies)
- **Domain**: autopilotamerica.com

## Codex reviews every change
Another AI reviewer (Codex) is auditing this work. Assume every commit is going to be read and challenged by a skeptical second set of eyes. Write like that reviewer is in the room.

- When you cite a dataset, API, field name, or legal statute — it WILL be verified.
- When you claim something was "tested" or "verified" — the reviewer will grep for the actual test / script / live run that proves it.
- When you make a claim about production state (env var, DB row, user behavior) — the reviewer will run the actual check.
- When a subagent reports back with a schema / dataset id / API endpoint, that report is a DRAFT hypothesis, not a fact. Verify it yourself with `curl` before coding against it.

## Ship Rules — no task is "done" until:
1. **Probe before code.** Any external data integration (Open Data, CTA, city APIs, third-party services) starts with a live `curl` of the real endpoint to confirm: the dataset exists, the schema matches what you expect, the most recent row is recent enough for our use case. Paste the probe output into the module's top-level comment or a companion smoke-test file.
2. **Live smoke test is acceptance criterion.** `npx tsc --noEmit` passing is NOT sufficient. For anything that touches external services, DB writes, or new user-facing output, there must be a script under `scripts/smoke-test-*.ts` that hits the real thing and that script must exit 0. Run it and paste the last few lines of output into the PR / chat before marking done.
3. **End-to-end verification when possible.** Before saying "shipped," ask: would this work for a real user right now, with a real ticket, today? If I only know it compiles, I haven't verified it — flag it as "awaiting real-world data" explicitly rather than claiming it's done.
4. **When in doubt, test it.** Running `curl` once is cheaper than shipping a broken defense into a user's contest letter. If there's any uncertainty about what a dataset returns or what a field is called, check first.
5. **Honest ledger per ship.** For each commit, be explicit about what was *actually* verified (live smoke ran, DB check passed, real API responded) vs. what merely compiles or only passes pattern-match checks against the source. Never claim more than was tested.

Precedent: three of four external-data integrations I shipped in one session were broken (wrong dataset IDs, wrong schemas, a "no stop found" branch that always fired). They compiled cleanly. Only the user pushing back caught it. These rules exist so that doesn't repeat.

## Explain things like I'm in fifth grade
When explaining what changed, what broke, or how a system works, use plain language and everyday analogies. Skip the jargon. Imagine you're telling a curious 10-year-old. Short sentences. No acronyms without spelling them out. If a concept needs a metaphor (door, permission slip, robot, file cabinet), use one.

This applies to end-of-turn summaries, bug diagnoses, and any "what did you do?" answers — not to code comments or commit messages, which stay precise and technical.

## Deployment — MANDATORY after every change
See **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** for full workflow. Summary:
1. Commit, push to GitHub
2. `npx vercel --prod --yes` (web)
3. `./gradlew assembleRelease` → adb install → Firebase App Distribution upload (Android)
4. iOS: user builds locally via Xcode
5. **Task is NOT complete until deployed and URL reported**
6. No dirty working tree at handoff

**NEVER ask "deploy now?" — just deploy.** If a code change ships, deployment is part of the change. Asking for permission to deploy wastes the user's time. The only exception is if the user has explicitly said "don't deploy yet" in this conversation.

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
