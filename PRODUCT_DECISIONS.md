# Product Decisions — Source of Truth

**Last updated: 2026-05-12**

This document records finalized product decisions. Claude Code MUST NOT change these behaviors without explicit owner approval. If a code change would contradict any decision below, stop and ask first.

---

## Authentication

| Decision | Value | Date |
|----------|-------|------|
| Primary login method | Google OAuth only | 2026-02-18 |
| Magic link login | **REMOVED** from login page | 2026-02-18 |
| Transactional magic links | Still used for alerts signup emails and Stripe purchase confirmation emails (one-time account access, not a login method) | 2026-02-18 |
| Mobile app auth | Google OAuth + Apple Sign-In | — |
| Password auth | Not offered in UI | — |

## Ticket Contesting

| Decision | Value | Date |
|----------|-------|------|
| Legal contest deadline (Chicago) | 21 days from ticket issue date | — |
| Evidence submission deadline (default) | **3 days after detection** — capped at Chicago's 21-day mail-contest hard deadline. Controlled by `user_profiles.fast_contest_submission` (default TRUE). | 2026-05-12 |
| Evidence submission deadline (opt-out) | When user toggles `fast_contest_submission=FALSE`: fall back to **Day 17 from ticket issue date**. User can stretch past Day 21 and accept a late-submission penalty. | 2026-05-12 |
| Auto-send deadline | Same date as evidence submission deadline — letters auto-mail when the evidence window closes (+1h buffer), regardless of whether the user submitted evidence | 2026-05-12 |
| Deadline computation | Centralized in `lib/contest-deadlines.ts` — `computeContestDeadlines(issueDate, detectedAt, fastSubmission)`. All detection paths (API cron, portal scraper, queue worker) MUST call this helper. | 2026-05-12 |
| Late ticket fallback | If ticket is old and the computed window already passed, give at least 48 hours from detection | 2026-02-18 |
| No violation date fallback | 14 days from detection | 2026-02-18 |
| Contest letter delivery | USPS via Lob | — |

## Pricing & Users

| Decision | Value | Date |
|----------|-------|------|
| Free tier | Email alerts (street cleaning, snow ban) — no charge | — |
| `is_paid` default | `false` — NEVER default to true. Only Stripe webhook sets true. | — |
| Free alert signups | NOT paid users. Never set `is_paid: true` in signup flows. | — |

## Mobile App — Saved Locations

| Decision | Value | Date |
|----------|-------|------|
| Max saved locations per user | 20 | — |
| Deduplication radius | ~50 meters | — |
| Storage | AsyncStorage (local) + `saved_parking_locations` table (server) | — |
| Persist across logout | Yes (saved destinations survive logout) | — |

## Mobile App — Parking Detection

| Decision | Value | Date |
|----------|-------|------|
| Android detection method | Bluetooth Classic (ACL events) | — |
| iOS detection method | CoreMotion (M-series coprocessor) + CLLocationManager | — |
| BT disconnect debounce | 10 seconds | — |
| CoreMotion min driving duration | 10 seconds (filters red lights) | — |
| CoreMotion after parking | **NEVER stop** — keep running always | — |
| GPS after parking | Drop to ultra-low-frequency keepalive (200m, 3km), NEVER fully stop | — |
| State machine | `ParkingDetectionStateMachine.ts` is single source of truth for driving/parked state | — |

## Mobile App — Camera Alerts

| Decision | Value | Date |
|----------|-------|------|
| Background mechanism (iOS) | Native Swift `AVSpeechSynthesizer` + local notifications | — |
| Foreground mechanism | JS `CameraAlertService` handles TTS, native fires local notifications | — |
| Double-speak prevention | Native checks `applicationState` — skips TTS if foreground | — |
| Audio background mode | Required (`UIBackgroundModes: audio`) for background TTS | — |

## Chicago Parking Fine Amounts — Canonical Reference

These are the official City of Chicago fine amounts. **NEVER change these without verifying against chicago.gov.** Do NOT assume a value found elsewhere in the codebase is correct — it may itself be wrong.

| Violation | Fine | Municipal Code | Notes |
|-----------|------|----------------|-------|
| Street cleaning | **$60** | 9-64-040(b) | NOT $65. This was wrong everywhere and propagated. |
| Expired meter (non-CBD) | **$50** | 9-64-190(a) | Outside the Central Business District |
| Expired meter (CBD) | **$70** | 9-64-190(b) | Loop / Central Business District |
| Residential permit zone | **$75** | 9-64-090(a) | |
| Winter overnight parking ban | **$60** | 9-64-020 | 3am-7am Dec 1 - Apr 1 on posted streets |
| Snow route violation | **$150+** | 9-64-020 | Plus towing costs |

**Rule:** When displaying fine amounts to users, use ONLY the values in this table. If you see a different amount in existing code, the code is wrong — fix it to match this table. Do NOT "standardize" fines to a single number across violation types — they are intentionally different.

## Web App

| Decision | Value | Date |
|----------|-------|------|
| Domain | autopilotamerica.com | — |
| Deployment | Vercel (auto-deploy on push to main) | — |
| Email service | Resend | — |
| Database | Supabase (RLS enabled on all tables) | — |

---

## How to Use This Document

1. **Before making a change**, check if it contradicts a decision above.
2. **If it does**, do NOT proceed — ask the owner first.
3. **To update a decision**, edit this file with the new value and date, then commit.
4. **Evidence deadline** is computed by `lib/contest-deadlines.ts`. Default behavior is 3 days from detection (per user_profiles.fast_contest_submission). The prior Day-17-from-issue safety net is only used when a user opts out. Updated 2026-05-12.
