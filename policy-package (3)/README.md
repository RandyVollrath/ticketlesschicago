# Chicago Parking-Hearing Outcomes by Hearing Officer — Data Package

Prepared for Illinois Policy. All figures verifiable from a single Illinois FOIA request to the City of Chicago Department of Administrative Hearings.

## What this package proves

Across **1,198,179 parking-ticket and automated-camera hearings** decided between **January 10, 2019 and September 9, 2025**, the strongest predictor of whether a motorist is found "Liable" is **which hearing officer is assigned to the case**.

- Highest "Liable" rate (officers with ≥500 cases): **80.4%** — Lonathan D. Hurse, 9,463 hearings
- Lowest "Liable" rate (officers with ≥500 cases): **27.2%** — Michael Quinn, 97,838 hearings
- **Spread: 53.2 percentage points** between hearings handled by these two officers
- Holding violation type constant, per-officer "Liable" rates still range from **7% to 83%** on the same statute

## Source

City of Chicago Department of Administrative Hearings, released under the Illinois Freedom of Information Act (5 ILCS 140) in response to FOIA request **H118909-110325**, filed 11/3/2025. Records contain one row per hearing, with the hearing officer's name, contest method, violation code, disposition, and disposition reason — all as recorded by the City.

## Files

| File | Purpose |
|---|---|
| `POLICY_MEMO.md` | One-page summary of findings, framed for publication |
| `hearing_officer_outcomes_all.csv` | All 74 officers, total hearings, Liable / Not Liable / Denied counts and percentages |
| `hearing_officer_by_violation.csv` | Each officer's outcomes broken down by violation category (608 rows) |
| `HOW_TO_VERIFY.md` | FOIA request text, schema, and the exact SQL queries needed to reproduce every number |
| `README.md` | This file |

## How to verify before publishing

`HOW_TO_VERIFY.md` contains the full reproduction guide:

1. File the same FOIA request (template provided), citing precedent **H118909-110325**.
2. Load the released file into SQLite or any database (schema provided).
3. Run the SQL queries listed in the guide.
4. Compare the output row-for-row against the CSVs in this package.

If the City releases an updated file (extending past 9/9/2025), the per-officer ratios are stable — every published figure should still be within roughly one percentage point.

## What this is not

- **Not a claim of bad faith** by any individual hearing officer. The data shows outcomes, not intent.
- **Not a judgment** about whether the harshest officers are wrong or the most lenient are right. The point is that the system is **producing inconsistent outcomes for similarly situated motorists** — a procedural-fairness concern regardless of which direction the variance runs.
- **Not a complete picture of all administrative hearings.** Limited to parking and automated-camera dockets; does not cover boots, impoundments, or building-code matters.

## Contact

Data prepared by Randy Vollrath. The underlying CSVs, SQL queries, and FOIA paper trail are reproducible from public records — Illinois Policy is welcome to publish, cite, or further audit any portion. Discrepancies between a reproduction run and the figures in this package should be reported back so the source can be re-checked.
