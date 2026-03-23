# Sweep System Design

**Date:** 2026-03-23
**Status:** Approved
**Purpose:** Automated bug-finding and fixing system that scans the entire app, fixes bugs at moderate risk tolerance, and deploys — triggered on demand.

## Overview

A superpowers skill (`sweep`) that dispatches 6 parallel agents across all app domains. Each agent scans its file set, identifies bugs, fixes them, and reports back. The orchestrator commits, pushes, and deploys everything.

## Trigger

User says "sweep the app" or invokes the sweep skill. Claude dispatches agents, collects results, deploys.

## Architecture

```
User triggers sweep
    → Orchestrator reads git state + known bug patterns
    → Dispatches 6 parallel domain agents
    → Each agent: scan → identify → fix → report
    → Orchestrator: collect fixes → build check → commit → push → deploy
    → Print sweep report
```

## Domain Agents

### Agent 1: API Security & Correctness
**Scope:** All files in `pages/api/`

**Checks:**
- Missing auth (no getSession/getUser/CRON_SECRET)
- IDOR (data access without user_id filter)
- Missing input validation
- SQL injection (string interpolation in queries)
- Missing error handling (no try-catch)
- Wrong HTTP method handling
- Missing rate limiting on sensitive endpoints
- Information leakage in error responses
- Race conditions (read-then-write without transactions)
- Broken response formats
- Dead code paths

### Agent 2: Parking Detection (Mobile)
**Scope:** BackgroundTaskService.ts, BluetoothService.ts, ParkingDetectionStateMachine.ts, BackgroundLocationService.ts, iOS Swift files

**Checks:**
- State machine transitions that skip states or get stuck
- Race conditions between BT events and CoreMotion
- Missing guards from CLAUDE.md (minDrivingDurationSec, GPS zero-speed)
- findBestLocalHistoryItemId matching bugs
- checkForMissedParking deduplication gaps
- CLVisit false positive paths
- Stale SharedPreferences/AsyncStorage after app kill
- Missing ensureSavedDeviceLoaded() before setCarConnected()
- GPS noise filter resets
- Departure tracking: every parking path must set state machine to PARKED
- Manual vs auto-detect history save correctness
- Recovery events with zero coordinates not rejected

### Agent 3: Autopilot Pipeline
**Scope:** chicago-portal-scraper.ts, pages/api/autopilot/*, pages/api/contest/*, webhooks/stripe.ts, lob-*, pages/api/foia/*

**Checks:**
- Portal scraper failure handling
- Stripe webhook signature verification and idempotency
- Contest letter generation completeness
- FOIA pipeline request/response flow
- Checkout flow price consistency
- Lob address validation and tracking
- Evidence processing validation
- Missing retry logic on transient failures

### Agent 4: Notifications
**Scope:** lib/notifications.ts, pages/api/cron/notify-*, street-cleaning/*, sweeper files

**Checks:**
- Street cleaning schedule/ward/section matching
- Sweeper alert dedup logic
- Push notification token refresh and payload format
- Email template rendering and unsubscribe
- Cron job auth and idempotency
- Notification preferences respected in send logic
- Rate limiting / duplicate prevention
- Timezone handling (Chicago time)

### Agent 5: Mobile WebView & Web Pages
**Scope:** pages/settings.tsx, check-your-street.tsx, destination-map.tsx, mobile WebView components

**Checks:**
- Auth handoff query params
- isMobileWebView stability (useRef pattern)
- touch-action: none on containers
- Decorative overlays missing pointerEvents: 'none'
- iOS viewport meta tag injection
- CSS injection timing (both hooks)
- Error boundaries in WebView pages
- onMessage handler presence for iOS
- SPA navigation interception
- Supabase localStorage key correctness

### Agent 6: Data Integrity & Infrastructure
**Scope:** lib/database.ts, lib/supabase.ts, migrations, type definitions

**Checks:**
- Type mismatches between database.types.ts and queries
- Missing RLS policies
- Queries without user_id filtering via service key
- Missing indexes
- Environment variable fallbacks
- is_paid set to true outside Stripe webhook
- Date/timezone bugs (UTC vs Chicago)
- Unused columns/tables

## Risk Tolerance: Moderate

- Fix clear bugs unconditionally
- Fix probable bugs (race conditions, missing error handling, edge cases) when confident
- Skip ambiguous issues — report but don't touch
- Never refactor for style alone

## Safety Rails

- No destructive database changes (no migrations, no ALTER TABLE)
- No dependency changes (no npm install/uninstall)
- No config file changes (.env, vercel.json, next.config.js read-only)
- Build check: if `npm run build` fails after fixes, revert the failing fix
- Single commit: all fixes in one commit for easy revert

## Severity Classification

| Severity | Description | Action |
|----------|-------------|--------|
| Critical | Auth bypass, data leak, crash, data corruption | Fix immediately |
| Medium | Race condition, missing validation, wrong logic | Fix if confident |
| Low | Missing error handling, dead code, inconsistencies | Fix if safe |

## Deploy Flow

1. `npm run build` — verify no build errors
2. `git add . && git commit` with structured message
3. `git push`
4. `npx vercel --prod --yes`
5. `./gradlew assembleRelease` (if mobile files changed)
6. `adb install` on connected devices
7. Firebase App Distribution upload
8. Report sweep results + production URL

## Sweep Report Format

```
=== SWEEP REPORT ===
Files scanned: N
Bugs fixed: X (C critical, M medium, L low)
Issues skipped: W (with reasons)
Deploy: [success/failed]
Production URL: [url]

FIXED:
- [severity] file:line — description of fix

SKIPPED:
- file:line — description of issue — reason skipped
```
