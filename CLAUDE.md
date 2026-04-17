# Project Instructions

## Product Decisions — READ FIRST
See **[PRODUCT_DECISIONS.md](./PRODUCT_DECISIONS.md)** for finalized product decisions. NEVER change behavior that contradicts that document without explicit owner approval.

## Codebase Overview
- **Web app**: Next.js (pages/), deployed to Vercel via push to `main`
- **Mobile app**: React Native in `TicketlessChicagoMobile/`, iOS + Android
- **Backend**: Supabase (auth, database, RLS policies)
- **Domain**: autopilotamerica.com

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
