# Product Decisions — Source of Truth

**Last updated: 2026-02-18**

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
| Evidence submission deadline | **Day 17 from ticket issue date** — unified across ALL code paths (API cron, portal scraper, queue worker, VA upload) | 2026-02-18 |
| Auto-send deadline | **Day 17** — letters auto-mail on Day 17 regardless of whether user submitted evidence. 4-day buffer before Day 21 hard deadline. | 2026-02-18 |
| Late ticket fallback | If ticket is old and Day 17 already passed, give at least 48 hours from detection | 2026-02-18 |
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
4. **Evidence deadline** has been unified to Day 17 across all code paths (confirmed 2026-02-18).
