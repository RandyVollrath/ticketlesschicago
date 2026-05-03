# Chicago Parking Hearings: Outcomes Vary 3x–10x Depending on Which Judge You Get

**Plain facts. Verifiable from public records.**

Source: City of Chicago FOIA response — Department of Administrative Hearings, parking and automated-camera disposition records, 1/10/2019 through 9/9/2025. **1,198,179 hearings, 74 hearing officers.**

---

## The headline finding

Across 1.2 million administrative hearings, **the single biggest predictor of whether a contested ticket is found "Liable" is which hearing officer is assigned to the case** — not the violation, not the contest method, not the evidence.

| | |
|---|---|
| Citywide "Liable" rate | **44.0%** |
| Highest officer "Liable" rate (≥500 cases) | **80.4%** — Lonathan D. Hurse (9,463 hearings) |
| Lowest officer "Liable" rate (≥500 cases) | **27.2%** — Michael Quinn (97,838 hearings) |
| Spread between highest and lowest officer | **53.2 percentage points** |
| Ratio | A motorist's case is roughly **3x more likely** to be found Liable in front of Hurse than in front of Quinn |

This is not a comparison of niche officers. **Quinn alone has decided ~98,000 cases** — more than 8% of every contested parking and camera ticket in Chicago over six and a half years.

---

## The same violation, two judges, ten-fold difference

The objection "different judges hear different kinds of cases" does not survive the data. Holding violation type constant, the spread is still enormous:

### Expired Registration (Expired Plate or Temporary Registration) — 175,996 hearings

| Officer | Hearings | Liable Rate |
|---|---:|---:|
| Lonathan D. Hurse | 1,312 | **82.8%** |
| Harriet J. Parker | 786 | 67.9% |
| Robert A. Sussman | 5,166 | 46.7% |
| *— citywide median —* | | *~25%* |
| Michael Quinn | 15,215 | **6.9%** |
| Karen L. Riley | 2,082 | 7.5% |
| Bernadette Freeman | 3,204 | 8.3% |

For an identical violation type, **one motorist faces an 83% chance of losing; another faces a 7% chance of losing.** Same city, same statute, same possible defenses.

### Street Cleaning — 73,090 hearings

| Officer | Hearings | Liable Rate |
|---|---:|---:|
| Lonathan D. Hurse | 394 | **93.1%** |
| Hugo Chaviano | 1,656 | 87.1% |
| Robert A. Sussman | 2,241 | 80.2% |
| *— citywide median —* | | *~66%* |
| Karen L. Riley | 666 | 34.8% |
| Michael Quinn | 5,633 | **26.0%** |

### Spread within violation type (officers with ≥200 cases of that violation)

| Violation | Lowest Liable % | Highest Liable % | Spread |
|---|---:|---:|---:|
| Expired Plate | 7.0% | 83.0% | **76 points** |
| No City Sticker | 9.6% | 77.7% | **68 points** |
| Street Cleaning | 26.0% | 93.1% | **67 points** |
| Residential Permit | 17.6% | 83.5% | **66 points** |
| Expired Meter | 15.0% | 55.0% | **40 points** |

A 67-point spread on a single violation, controlling for case type, cannot be explained by differences in the underlying tickets. It is a feature of the adjudicator.

---

## What this means in practice

1. **Adjudication is a lottery.** Cases are assigned to officers administratively, not by lot draw the motorist sees. A motorist contesting an identical ticket has dramatically different odds depending on the assignment.
2. **The disparity scales.** Multiplied across 1.2 million hearings, the gap between the harshest and most lenient officers represents tens of thousands of "Liable" findings that would have been "Not Liable" under a different assignment, and vice versa. At a city average ticket cost of ~$80, a 53-point spread on 1.2M cases is on the order of **$50M+ in fines whose outcome turns on the assignment alone.**
3. **It is not random noise.** The patterns are stable across years, violation types, and contest methods (mail, in-person, virtual). The same officers anchor the top and bottom of the rankings on every breakdown.
4. **There is no public scorecard.** Chicago does not publish per-officer outcome rates. Motorists cannot know in advance who will hear their case, and have no basis to seek review when their officer's liable rate is an outlier.

---

## What the recipient can do with this

- The full per-officer dataset is in **`hearing_officer_outcomes_all.csv`** (74 officers, all dispositions).
- Per-officer x violation-category breakdown is in **`hearing_officer_by_violation.csv`**.
- Per-officer x contest-method breakdown is in **`hearing_officer_by_method.csv`**.
- The original FOIA-released file used to build these, plus the SQL to reproduce, is in **`HOW_TO_VERIFY.md`**.

The recipient is welcome to publish, cite, or further audit. **Numbers are stated exactly as they appear in the FOIA response.** Any discrepancy from a reproduction run should be reported back so the source can be re-checked.

---

## What this is NOT

- Not a claim that any individual officer is acting in bad faith. The data shows outcomes, not intent.
- Not a claim that the "harshest" officers are wrong and the "most lenient" are right (or vice versa). It is a claim that **the system is producing inconsistent outcomes for similarly situated motorists**, which is a due-process and procedural-fairness concern regardless of which direction the variance runs.
- Not a complete picture of the hearings system: this is the parking and automated-camera docket, not boots, impoundments, or building-code hearings.

---

## Source and methodology, in one paragraph

Records were obtained from the City of Chicago Department of Administrative Hearings under the Illinois Freedom of Information Act (5 ILCS 140) and loaded verbatim into a SQLite database. The `hearings` table contains one row per hearing with fields for the ticket number, violation code and description, contest method, hearing officer, hearing location, disposition, and reason. No imputation or smoothing was performed. The "Liable rate" is `count(disposition='Liable') / count(*)` per officer. Officers with fewer than 500 lifetime hearings were excluded from headline rankings to avoid small-sample artifacts; the full file lists all 74. Date range: **1/10/2019 – 9/9/2025**.
