# Chicago Tow Portal Delay Monitor

Two TypeScript scripts for monitoring and analyzing the Chicago Data Portal's towed vehicles API to measure publication delays.

## Overview

The Chicago Data Portal publishes towed vehicle records at `https://data.cityofchicago.org/resource/ygr5-vcbg.json`. These scripts track when each record first appears in the API versus when the vehicle was actually towed (`tow_date`), measuring the delay between tow event and API publication.

## Scripts

### 1. `monitor-tow-portal-delay.ts` — Continuous Monitor

**Purpose**: Polls the API every 5 minutes, tracks new records, calculates delays, persists state.

**Usage**:
```bash
npx tsx scripts/monitor-tow-portal-delay.ts
```

**What it does**:
- On first run: Fetches latest 1000 records and marks them as "already known" (baseline)
- Every 5 minutes: Fetches latest 200 records
- For each NEW record (not in baseline):
  - Calculates `hours_since_tow_date` = time between `tow_date` and when our script first saw it
  - Logs to console: "New tow record: INV#1729500, tow_date=2026-03-18, first seen 14.4h after tow_date"
  - Appends to persistent JSON file
- Every hour: Prints summary stats (mean/median delay, distribution, patterns)
- Graceful shutdown: CTRL+C saves state before exit

**Output file**: `/home/randy-vollrath/ticketless-chicago/data/tow-portal-monitor.json`

**Runs continuously** — leave it running in a tmux/screen session or as a systemd service.

### 2. `tow-monitor-report.ts` — Report Generator

**Purpose**: Reads the monitor data file and prints a formatted analysis.

**Usage**:
```bash
npx tsx scripts/tow-monitor-report.ts
```

**What it shows**:
- Overall monitoring duration and record counts
- Delay statistics: mean, median, min, max, std deviation
- Distribution histogram (buckets: <1h, 1-6h, 6-12h, 12-24h, etc.)
- Midnight vs non-midnight `tow_date` analysis
- Time-of-day patterns (when records first appeared)
- Day-of-week patterns
- Top tow locations
- Recent records (last 10)

**Run anytime** to see current findings without interrupting the monitor.

## Data Format

The JSON state file has three main sections:

### `known_records`
Dictionary of all inventory numbers seen, with first-seen timestamp:
```json
"1729500": {
  "inventory_number": "1729500",
  "tow_date": "2026-03-18T00:00:00.000",
  "first_seen_at": "2026-03-18T14:23:00.000Z",
  "make": "FORD",
  "color": "WHI",
  "towed_to_address": "10300 S. Doty"
}
```

### `new_records_log`
Chronological log of each NEW record detected (excludes baseline):
```json
{
  "inventory_number": "1729500",
  "tow_date": "2026-03-18T00:00:00.000",
  "first_seen_at": "2026-03-18T14:23:00.000Z",
  "hours_since_tow_date": 14.38,
  "tow_date_is_midnight": true
}
```

### `stats`
Monitoring metadata:
```json
{
  "monitoring_since": "2026-03-18T14:00:00.000Z",
  "total_new_records_seen": 42,
  "polls_completed": 156,
  "last_poll_at": "2026-03-19T02:00:00.000Z",
  "seeded_count": 987
}
```

## Important Notes

### Midnight Timestamp Issue
Most `tow_date` values are midnight (00:00:00) — the API only stores the tow **day**, not the precise time. For these records:
- `hours_since_tow_date` measures "hours since midnight of tow day"
- NOT the actual time since the vehicle was towed
- Example: A car towed at 11 PM on March 18 has `tow_date=2026-03-18T00:00:00`, so if we first see it at 2 AM on March 19, the delay shows as **26 hours** (when the actual tow-to-API delay was only 3 hours)

Records are flagged with `tow_date_is_midnight: true` to help interpret these values.

### Baseline Seeding
The first run fetches 1000 recent records and marks them all as "already known." This prevents counting pre-existing records as "new" — only records that appear AFTER monitoring starts count toward delay measurements.

### Restart Behavior
State persists to JSON, so stopping and restarting the monitor doesn't lose data. The monitor picks up where it left off.

### .gitignore
The data file (`data/tow-portal-monitor.json`) is gitignored — it's for local analysis only.

## Example Workflow

**Day 1 — Start monitoring:**
```bash
# Terminal 1: Start continuous monitor
npx tsx scripts/monitor-tow-portal-delay.ts

# Terminal 2: Check report after a few hours
npx tsx scripts/tow-monitor-report.ts
```

**Day 2 — Check findings:**
```bash
# Monitor is still running in Terminal 1
# Just run the report to see overnight results
npx tsx scripts/tow-monitor-report.ts
```

**Week later — Full analysis:**
```bash
# Report now has days of data
npx tsx scripts/tow-monitor-report.ts > tow-delay-analysis.txt
```

## Systemd Service (Optional)

To run the monitor as a background service:

1. Create `/etc/systemd/user/tow-monitor.service`:
```ini
[Unit]
Description=Chicago Tow Portal Delay Monitor

[Service]
Type=simple
WorkingDirectory=/home/randy-vollrath/ticketless-chicago
ExecStart=/usr/bin/npx tsx scripts/monitor-tow-portal-delay.ts
Restart=on-failure

[Install]
WantedBy=default.target
```

2. Enable and start:
```bash
systemctl --user enable tow-monitor
systemctl --user start tow-monitor
systemctl --user status tow-monitor
```

3. View logs:
```bash
journalctl --user -u tow-monitor -f
```

## Questions to Answer

These scripts can help answer:
- How long does it take for towed vehicle records to appear in the API?
- Is there a pattern by time of day or day of week?
- Do certain tow locations publish faster than others?
- What percentage of records appear within 1 hour? 6 hours? 24 hours?
- How often does the midnight timestamp issue affect delay calculations?
