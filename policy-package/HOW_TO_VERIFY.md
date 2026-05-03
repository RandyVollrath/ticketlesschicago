# How to Independently Verify These Numbers

This document is for anyone who wants to confirm the figures in `POLICY_MEMO.md` from primary sources, without trusting our extract. Every number in the memo is reproducible from a single FOIA request and a single SQL query.

---

## Step 1 — File this FOIA request

Send to:
> **City of Chicago Department of Administrative Hearings — FOIA Officer**
> 400 W. Superior St., Chicago, IL 60654
> foia@cityofchicago.org

Suggested request text:

> Pursuant to the Illinois Freedom of Information Act (5 ILCS 140), I request all administrative-hearing disposition records for parking violations and automated-camera (red light, speed) violations from January 1, 2019 through the most recent date for which records are available. For each hearing, please provide the following fields: ticket number, issue date and time, street number, street direction, street name, ward, violation code, violation description, disposition date and time, contest method (mail / in-person / virtual), hearing officer name, hearing location, disposition (Liable / Not Liable / Denied / etc.), reason for disposition, and any associated note. CSV or Excel format is preferred.

The City has previously released this dataset; you should not need to negotiate scope. If they balk, point them to past releases — the file we used contained 1,198,179 rows covering 1/10/2019 – 9/9/2025.

---

## Step 2 — Load into a database

Once you receive the file (typically `Hearings.xlsx` or similar), import it into SQLite, Postgres, or any tool you prefer. Below uses SQLite for portability.

```bash
# Convert Excel to CSV first if needed (LibreOffice / Excel / pandas)
sqlite3 verify.db <<'SQL'
CREATE TABLE hearings (
  ticket_number TEXT,
  issue_datetime TEXT,
  street_num TEXT,
  street_dir TEXT,
  street_name TEXT,
  ward TEXT,
  violation_code TEXT,
  violation_desc TEXT,
  dispo_datetime TEXT,
  contest_method TEXT,
  hearing_officer TEXT,
  hearing_location TEXT,
  disposition TEXT,
  reason TEXT,
  note TEXT
);
.mode csv
.import --skip 1 hearings.csv hearings
SQL
```

---

## Step 3 — Reproduce the headline numbers

### A. Total hearings and citywide liable rate

```sql
SELECT
  COUNT(*) AS total_hearings,
  ROUND(100.0 * SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END) / COUNT(*), 2) AS citywide_liable_pct
FROM hearings;
```

Expected: ~1,198,179 hearings, ~44.0% liable.

### B. Per-officer outcomes (the master table)

```sql
SELECT
  hearing_officer,
  COUNT(*) AS total,
  SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END) AS liable,
  SUM(CASE WHEN disposition='Not Liable' THEN 1 ELSE 0 END) AS not_liable,
  ROUND(100.0 * SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END) / COUNT(*), 2) AS liable_pct
FROM hearings
WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
GROUP BY hearing_officer
ORDER BY liable_pct DESC;
```

Compare row-for-row against `hearing_officer_outcomes_all.csv` in this package.

### C. The harshest and most lenient officers (≥500 hearings)

```sql
-- Harshest (highest liable rate)
SELECT hearing_officer, COUNT(*) AS total,
       ROUND(100.0*SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END)/COUNT(*), 2) AS liable_pct
FROM hearings
WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
GROUP BY hearing_officer
HAVING total >= 500
ORDER BY liable_pct DESC LIMIT 10;

-- Most lenient (lowest liable rate)
SELECT hearing_officer, COUNT(*) AS total,
       ROUND(100.0*SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END)/COUNT(*), 2) AS liable_pct
FROM hearings
WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
GROUP BY hearing_officer
HAVING total >= 500
ORDER BY liable_pct ASC LIMIT 10;
```

Expected top of harshest list: Lonathan D. Hurse, ~80.4% liable on ~9,463 hearings.
Expected top of most-lenient list: Michael Quinn, ~27.2% liable on ~97,838 hearings.

### D. Same-violation comparison (controls for case mix)

```sql
SELECT hearing_officer, COUNT(*) AS hearings,
       ROUND(100.0*SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END)/COUNT(*), 1) AS liable_pct
FROM hearings
WHERE violation_desc LIKE '%EXPIRED PLATE%'
  AND hearing_officer IS NOT NULL AND hearing_officer != ''
GROUP BY hearing_officer
HAVING hearings >= 200
ORDER BY liable_pct DESC;
```

Expected: Hurse ~83% liable on Expired Plate; Quinn ~7% liable on Expired Plate.

Replace `EXPIRED PLATE` with `STREET CLEANING`, `CITY STICKER`, `RESIDENTIAL PERMIT`, or `EXPIRED METER` to see each violation's per-officer spread.

### E. Within-violation spread

```sql
WITH per_officer AS (
  SELECT hearing_officer, violation_desc, COUNT(*) AS hearings,
         100.0*SUM(CASE WHEN disposition='Liable' THEN 1 ELSE 0 END)/COUNT(*) AS liable_pct
  FROM hearings
  WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
  GROUP BY hearing_officer, violation_desc
  HAVING hearings >= 200
)
SELECT violation_desc,
       ROUND(MIN(liable_pct), 1) AS min_liable_pct,
       ROUND(MAX(liable_pct), 1) AS max_liable_pct,
       ROUND(MAX(liable_pct) - MIN(liable_pct), 1) AS spread_points
FROM per_officer
GROUP BY violation_desc
ORDER BY spread_points DESC LIMIT 15;
```

Expected: 60–76 percentage-point spreads on the major violation types.

---

## Step 4 — Sanity checks

These are useful for spotting any data-quality issues before publishing:

```sql
-- Disposition values present
SELECT disposition, COUNT(*) FROM hearings GROUP BY disposition ORDER BY 2 DESC;

-- Officers with fewer than 500 hearings (the long tail)
SELECT COUNT(*) FROM (
  SELECT hearing_officer FROM hearings
  WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
  GROUP BY hearing_officer HAVING COUNT(*) < 500
);

-- Date range covered
SELECT MIN(dispo_datetime), MAX(dispo_datetime) FROM hearings;

-- Contest method breakdown
SELECT contest_method, COUNT(*) FROM hearings GROUP BY contest_method ORDER BY 2 DESC;
```

---

## Files included in this package

| File | What it is |
|---|---|
| `POLICY_MEMO.md` | One-page summary of findings |
| `hearing_officer_outcomes_all.csv` | All 74 officers, full dispositions, liable %, not-liable %, denied % |
| `hearing_officer_by_violation.csv` | Officer x violation category (Street Cleaning, Expired Plate, etc.) |
| `hearing_officer_by_method.csv` | Officer x contest method (Mail / In-Person / Virtual) |
| `HOW_TO_VERIFY.md` | This file |

---

## Caveats and known gaps

1. **Dataset edge dates.** The file used here ends 9/9/2025. Newer hearings exist but were not in the FOIA response we received. A fresh FOIA will yield more rows but the per-officer ratios are stable across the period.
2. **Officer name normalization.** Names are stored as-is. We have not attempted to merge potential duplicates (e.g., "Jane Smith" vs. "Jane M. Smith"). One name in the data has a trailing space (`Zedrick T. Braden `) — kept as-is.
3. **Small-sample officers.** Officers with <500 hearings are included in the master CSV but excluded from headline rankings. Their rates are still informative but more sensitive to randomness.
4. **"Denied" vs "Not Liable."** "Denied" is a procedural outcome (e.g., late filing) — we treat it as neither a win nor a loss for the motorist. Liable% = liable / total, so denied cases are in the denominator but not the numerator.
5. **No causal claim.** Variation in officer outcomes does not by itself prove unfairness. It does establish that **the assignment matters more than any other observable factor**, which is the policy point.
