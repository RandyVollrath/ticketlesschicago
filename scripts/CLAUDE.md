# Scripts Directory Instructions

## Overview
This directory contains 100+ automation, debugging, and migration scripts. Most are one-off or diagnostic — only a few run in production.

## Production Scripts
- **`autopilot-check-portal.ts`** — The parking ticket portal scraper. Runs Mon/Thu via systemd user timer. Fetches monitored plates from Supabase, looks them up on CHI PAY, creates contest letters, emails evidence requests. Uses Playwright (headless Chromium). See root CLAUDE.md "CHI PAY Portal Scraper" section for full details.
- **`update-neighborhood-data.py`** — Weekly Chicago Data Portal sync. Runs via GitHub Actions (Sunday 6 AM UTC).

## Running Scripts
- TypeScript scripts: `npx tsx scripts/<script>.ts`
- JavaScript scripts: `node scripts/<script>.js`
- Python scripts: `python3 scripts/<script>.py`
- Most scripts need environment variables from `.env` or `.env.local` — use `dotenv` or pass via env

## Conventions
- `check-*.js` — Diagnostic/debugging scripts (read-only, safe to run anytime)
- `test-*.js` — Integration test scripts for specific features
- `apply-*.ts` — Database migration scripts (destructive, run with care)
- `fix-*.js` — One-off data repair scripts
