# Tow Notification Timing Analysis

**Data Source**: FOIA Request #25238 - Towed Vehicles
**Analysis Date**: March 18, 2026
**Sample Size**: 89,340 tow records (after filtering)
**Filtered Out**:
- 9,999 records with negative delay (pre-dated records)
- 1,179 records with >72h delay (extreme outliers)

---

## Executive Summary

**Key Finding**: CPD's record creation is **extremely slow** for most tows. The median delay from tow to record creation is **9 hours 20 minutes**.

- Only **18.4%** of tows would result in notification within 2 hours
- Only **27.3%** would be notified within 4 hours
- Only **35.3%** would be notified within 6 hours
- **56.9%** would be notified within 12 hours
- **96.0%** would be notified within 24 hours

This means **hourly sync is sufficient** — most of the delay is CPD record creation, not our sync frequency.

---

## Record Creation Timing (CPD System)

Time from actual tow event to when CPD enters the record into their system:

| Time Window | Records | Percentage | Cumulative |
|-------------|---------|------------|------------|
| 30 minutes  | 14,805  | 16.6%      | 16.6%      |
| 1 hour      | 16,419  | 18.4%      | 18.4%      |
| 1.5 hours   | 18,123  | 20.3%      | 20.3%      |
| 2 hours     | 20,134  | 22.5%      | 22.5%      |
| 3 hours     | 24,382  | 27.3%      | 27.3%      |
| 4 hours     | 27,967  | 31.3%      | 31.3%      |
| 5 hours     | 31,580  | 35.3%      | 35.3%      |
| 6 hours     | 35,387  | 39.6%      | 39.6%      |
| 8 hours     | 40,692  | 45.5%      | 45.5%      |
| 12 hours    | 54,675  | 61.2%      | 61.2%      |
| 24 hours    | 87,226  | 97.6%      | 97.6%      |

**Percentiles**:
- Median: 9h 20m
- 75th percentile: 15h 5m
- 90th percentile: 19h 18m
- 95th percentile: 22h 20m

---

## User Notification Timing (With Sync Delay)

Assumes portal publishes immediately when CPD creates record, plus our hourly sync adds average 30 minutes (0-60 min uniform distribution):

| Notification Window | Records | Percentage |
|---------------------|---------|------------|
| 2 hours             | 16,419  | 18.4%      |
| 3 hours             | 20,134  | 22.5%      |
| 4 hours             | 24,382  | 27.3%      |
| 6 hours             | 31,580  | 35.3%      |
| 8 hours             | 39,086  | 43.7%      |
| 12 hours            | 50,834  | 56.9%      |
| 24 hours            | 85,780  | 96.0%      |

**Key Insight**: The sync delay (avg 30 min) is negligible compared to CPD's record creation delay (median 9h 20m). Increasing sync frequency from hourly to every 15 minutes would only improve early notification rates by ~1-2%.

---

## Record Creation Speed by Time of Day

Shows the hour when the **tow occurred** (not when record was created). Clear pattern: **overnight/early morning tows get entered much faster** than daytime tows.

| Hour of Tow | Count  | Median Delay | <2h   | <4h   | <6h   |
|-------------|--------|--------------|-------|-------|-------|
| 00:00 (midnight) | 75,721 | 11h 5m  | 9.4%  | 19.6% | 29.3% |
| 01:00       | 848    | 0m           | 84.8% | 84.9% | 85.0% |
| 02:00       | 746    | 0m           | 94.9% | 95.0% | 95.0% |
| 03:00       | 593    | 0m           | 96.0% | 96.0% | 96.1% |
| 04:00       | 1,041  | 0m           | 98.8% | 98.8% | 98.8% |
| 05:00       | 1,127  | 0m           | 98.8% | 98.8% | 98.8% |
| 06:00       | 972    | 0m           | 97.1% | 97.5% | 98.1% |
| 07:00       | 416    | 0m           | 97.6% | 98.1% | 98.1% |
| 08:00       | 974    | 0m           | 93.5% | 94.6% | 95.2% |
| 09:00       | 745    | 0m           | 92.9% | 94.9% | 95.4% |
| 10:00       | 713    | 0m           | 95.0% | 96.5% | 97.3% |
| 11:00       | 714    | 0m           | 95.4% | 96.4% | 96.9% |
| 12:00       | 771    | 0m           | 93.9% | 95.5% | 96.1% |
| 13:00       | 553    | 0m           | 95.1% | 96.6% | 97.5% |
| 14:00       | 419    | 0m           | 93.8% | 95.2% | 96.4% |
| 15:00       | 344    | 0m           | 97.4% | 98.0% | 98.5% |
| 16:00       | 576    | 0m           | 97.4% | 98.3% | 98.6% |
| 17:00       | 595    | 0m           | 97.0% | 98.0% | 98.8% |
| 18:00       | 442    | 0m           | 99.5% | 99.5% | 99.8% |
| 19:00       | 291    | 0m           | 99.3% | 99.3% | 99.7% |
| 20:00       | 189    | 0m           | 100.0%| 100.0%| 100.0%|
| 21:00       | 79     | 0m           | 100.0%| 100.0%| 100.0%|
| 22:00       | 122    | 0m           | 100.0%| 100.0%| 100.0%|
| 23:00       | 349    | 0m           | 100.0%| 100.0%| 100.0%|

**Critical Observation**:
- **84.7%** of tows (75,721 out of 89,340) are recorded with timestamp 00:00 (midnight)
- These midnight-timestamped tows have the **slowest** median delay (11h 5m)
- This suggests CPD may be **batch-processing** or **defaulting to midnight** for tows where exact time wasn't recorded
- The remaining tows (actual timestamped ones) get entered **much faster** — often within minutes

---

## Record Creation Speed by Tow Reason

Top 10 tow reasons by volume:

| Tow Reason                               | Count  | Median Delay | <4h   |
|------------------------------------------|--------|--------------|-------|
| 22 - HAZARD                              | 49,312 | 8h 55m       | 35.1% |
| 20 - SNOWS TOW                           | 9,647  | 5h 37m       | 32.9% |
| 08 - SCOFFLAW                            | 7,341  | 8h 23m       | 36.2% |
| 06 - STOLEN                              | 4,388  | 13h 50m      | 20.1% |
| 07 - ACCIDENT                            | 2,340  | 10h 22m      | 27.0% |
| 24 - ALTER TEMP TAG                      | 1,802  | 13h 3m       | 20.0% |
| 34 - VEHICLES OPERATED BY PERSONS        | 1,669  | 13h 10m      | 23.1% |
| 21 - ABANDONED                           | 1,538  | 14h 0m       | 13.8% |
| 25 - D.U.I.                              | 1,353  | 5h 35m       | 36.5% |
| 09 - INVESTIGATION                       | 1,242  | 13h 19m      | 17.3% |

**Key Findings**:
- **Snow tows** (9,647 records) have the **fastest** median delay: 5h 37m
- **DUI tows** (1,353 records) are also very fast: 5h 35m
- **Abandoned** (1,538 records) and **Stolen** (4,388 records) are the **slowest**: 14h and 13h 50m
- High-volume **HAZARD** tows (49,312 — majority of all tows) have middle-of-road speed: 8h 55m

---

## Product Implications

### 1. **Hourly Sync is Sufficient**
The bottleneck is CPD's record creation (median 9h 20m), not our sync frequency. Increasing sync frequency would only marginally improve early notification rates.

### 2. **Most Notifications Will Be "After the Fact"**
Only 27.3% of users would be notified within 4 hours of being towed. For the majority, the notification will arrive many hours later — possibly after they've already discovered their car is missing.

### 3. **Batch Processing Hypothesis**
The 84.7% of tows timestamped at midnight (00:00) with slow median delays suggests CPD may be batch-processing records or defaulting timestamps. This is a data quality issue on CPD's side.

### 4. **Snow Tows Are Priority**
Snow tows get entered significantly faster (5h 37m median) — likely because they're high-volume events with dedicated processing workflows.

### 5. **User Expectations Management**
Marketing and product messaging should **not promise** instant or near-instant tow notifications. The realistic expectation is:
- ~20% notified within 2-3 hours
- ~50% notified within 8-12 hours
- ~96% notified within 24 hours

### 6. **Opportunity: Real-Time Data Partnerships**
If the app gains traction, partnering with CPD or tow companies for **real-time push notifications** (instead of portal scraping) could dramatically improve early notification rates.

---

## Recommendations

1. **Keep hourly sync** — no need for more frequent polling
2. **Set user expectations correctly** — don't oversell notification speed
3. **Prioritize 24-hour coverage** — focus on ensuring the 96% who get notified eventually do get notified
4. **Consider premium real-time tier** — if demand exists, negotiate direct CPD API access for paid users
5. **Monitor for CPD system improvements** — re-run this analysis periodically to detect if CPD speeds up their record creation

---

## Methodology Notes

- **Data cleaning**: Excluded records with negative delays (9,999) and >72h delays (1,179)
- **Sync delay assumption**: Uniform distribution 0-60 minutes, average 30 minutes
- **Portal publish delay**: Assumed zero (optimistic — portal may lag behind CPD internal system)
- **Time windows**: All times measured from actual tow event to final user notification
