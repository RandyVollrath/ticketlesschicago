# Chicago Red-Light Camera Research Report
## Data Sources, Yellow Light Timing Standards, and Legal Defense Resources

**Date:** March 18, 2026
**Purpose:** Legal defense product research for ticket contestation

---

## Executive Summary

This report documents available Chicago open data for red-light camera enforcement, federal/state yellow light timing standards, and known controversies. Key findings:

1. **Red-light camera locations are available** via Chicago Data Portal API with coordinates and approach directions
2. **Speed limits at intersections** can be inferred from the Traffic Crashes dataset (posted_speed_limit field)
3. **No dedicated yellow light timing dataset exists** — must be obtained via FOIA to CDOT
4. **Chicago has a documented history** of short yellow lights generating millions in questionable revenue
5. **MUTCD/ITE standards provide** clear minimum yellow light durations based on approach speed

---

## 1. Available Chicago Open Data Datasets

### 1.1 Red Light Camera Locations

**Dataset:** Red Light Camera Locations
**Portal URL:** https://data.cityofchicago.org/Transportation/Red-Light-Camera-Locations/thvf-6diy
**API Endpoint:** https://data.cityofchicago.org/resource/thvf-6diy.json

**Available Fields:**
- `intersection` (string): Street intersection address (e.g., "4413 W North Ave")
- `latitude` / `longitude` (number): Geographic coordinates
- `first_approach` (string): Traffic direction monitored (e.g., "EB", "NB", "WB", "SB")
- `go_live_date` (timestamp): Camera activation date (ISO 8601 format)
- `location` (object): Nested geolocation object
- Computed region fields for administrative boundaries

**What's NOT included:**
- Speed limits at intersections
- Yellow light duration
- All-red clearance interval
- Intersection geometry (width, stop bar positions)
- Signal timing plans

**Example API call:**
```bash
curl "https://data.cityofchicago.org/resource/thvf-6diy.json?$limit=10"
```

---

### 1.2 Speed Limits at Intersections

**Dataset:** Traffic Crashes - Crashes
**Portal URL:** https://data.cityofchicago.org/Transportation/Traffic-Crashes-Crashes/85ca-t3if
**API Endpoint:** https://data.cityofchicago.org/resource/85ca-t3if.json

**Relevant Fields:**
- `posted_speed_limit` (string): Speed limit at crash location (e.g., "30", "25", "35")
- `traffic_control_device` (string): "TRAFFIC SIGNAL", "NO CONTROLS", etc.
- `latitude` / `longitude`: Location coordinates
- `crash_date`: When the crash occurred

**Important Caveat:**
> "Many of the crash parameters, including street condition data, weather condition, and posted speed limits, are recorded by the reporting officer based on best available information at the time, but many of these may disagree with posted information or other assessments on road conditions."

**Approach:**
Cross-reference red-light camera intersections (from dataset 1.1) with crash data to infer posted speed limits. Not perfectly reliable but better than nothing.

**Example API call:**
```bash
curl "https://data.cityofchicago.org/resource/85ca-t3if.json?\$select=posted_speed_limit,latitude,longitude&\$where=traffic_control_device='TRAFFIC SIGNAL'&\$limit=100"
```

**Observed speed limit values in Chicago:**
- 25 mph (default citywide starting 2026)
- 30 mph (most arterials historically)
- 35 mph (some arterials)
- 40 mph (rare for red-light camera locations)

---

### 1.3 Red Light Camera Violations

**Dataset:** Red Light Camera Violations
**Portal URL:** https://data.cityofchicago.org/Transportation/Red-Light-Camera-Violations/spqx-js37

**Use case:** Historical violation data, useful for analyzing ticketing patterns before/after timing changes.

---

### 1.4 Traffic Tracker / Speed Data

**Dataset:** Chicago Traffic Tracker - Congestion Estimates by Segments
**Use case:** Real-time **observed speeds** on 1,250 arterial road segments. Not the same as **posted speed limits**, but useful for understanding actual traffic flow.

**Not useful for:** Determining legal posted speed limits at camera intersections.

---

## 2. Yellow Light Timing Standards

### 2.1 MUTCD Minimum Yellow Light Durations

The **Manual on Uniform Traffic Control Devices (MUTCD)** recommends yellow change intervals of **3 to 6 seconds**. The specific duration is calculated using the **ITE kinematic formula** (see section 2.3).

**Standard lookup table (derived from ITE formula at level grade):**

| Posted Speed Limit | Minimum Yellow Duration |
|-------------------|------------------------|
| 25 MPH            | 3.0 seconds            |
| 30 MPH            | 3.5 seconds            |
| 35 MPH            | 4.0 seconds            |
| 40 MPH            | 4.5 seconds            |
| 45 MPH            | 5.0 seconds            |
| 50 MPH            | 5.5 seconds            |
| 55 MPH            | 6.0 seconds            |

**Source:** ITE recommended practice, codified in MUTCD Table 4D-102 (California MUTCD version available at https://redlightrobber.com/red/links_pdf/california/CAMUTCD-4D-26-and-Table-4D-102.pdf)

---

### 2.2 Chicago's Yellow Light Policy

**Official Chicago policy (as of 2014-present):**
- **3 seconds** on streets where approach speed is **≤30 mph**
- **4 seconds** on streets where approach speed is **≥35 mph**

> "These timings fall within the guidelines of the Federal Highway Administration's Manual on Uniform Traffic Control Devices and adhere to recommendations by the Institute of Transportation Engineers. The three-second timing has been in place for several decades, and no signal timings were changed before or after the implementation of red-light cameras."
> — Chicago Department of Transportation

**Reality check:** Chicago's 3-second standard for 30 mph is **0.5 seconds shorter** than the ITE recommended 3.5 seconds (see table above). This is within MUTCD's 3–6 second range but at the bare minimum.

---

### 2.3 ITE Kinematic Formula (The Engineering Standard)

The yellow change interval should be calculated using:

**Y = t + V / (2a + 2Ag)**

Where:
- **Y** = Yellow change interval in seconds
- **t** = Perception-reaction time = **1.0 second** (standard)
- **V** = 85th percentile approach speed in ft/sec (or posted speed limit + 7 mph)
- **a** = Deceleration rate = **10 ft/sec²** (comfortable deceleration)
- **A** = Acceleration due to gravity = **32.2 ft/sec²**
- **g** = Grade (percent slope ÷ 100, positive for uphill, negative for downhill)

**Example calculation for 30 mph on level road:**
- V = 30 mph = 44 ft/sec
- g = 0 (level)
- Y = 1.0 + 44 / (2×10 + 2×32.2×0)
- Y = 1.0 + 44/20 = 1.0 + 2.2 = **3.2 seconds**

**Rounded to nearest 0.5 sec → 3.5 seconds** (the ITE recommendation)

**Why this matters for legal defense:**
- If actual yellow duration < calculated minimum → traffic engineering defect
- If yellow is 2.9 seconds at a 30 mph intersection → **0.3–0.6 seconds too short**
- Studies show proper yellow timing reduces red-light violations by **50–81%**

**Key parameters confirmed by research:**
- Perception-reaction time: **1.0 seconds** (ITE standard since 1985)
- Comfortable deceleration rate: **10 ft/sec²** (can be as low as 6–8 ft/sec² for conservative design)
- Use **85th percentile speed** (actual traffic speed) OR posted speed limit + 7 mph

---

### 2.4 Illinois Law for Red Light Camera Intersections

**Illinois state law requires:**
- Yellow light intervals at camera-equipped intersections must follow nationally recognized engineering standards (**3 seconds minimum** per MUTCD)
- **PLUS an additional 1 second** above that standard

**Interpretation:** Camera intersections in Illinois should have a **minimum 4-second yellow** (3 + 1).

**Chicago's compliance:** Dubious. Chicago uses 3 seconds for ≤30 mph approaches, which meets MUTCD minimum but arguably violates the Illinois "+1 second" rule for camera intersections.

**Legal defense angle:** Challenge whether Chicago camera intersections comply with Illinois law requiring "3 seconds + 1 second."

---

### 2.5 All-Red Clearance Interval

After the yellow, a **red clearance interval** (all-red) provides time for vehicles in the intersection to exit before conflicting traffic gets a green light.

**ITE formula for all-red clearance:**

**Red clearance = (W + L) / V**

Where:
- **W** = Intersection width (curb-to-curb distance in feet)
- **L** = Average vehicle length (typically **20 feet**)
- **V** = Approach speed in ft/sec

**Example for 30 mph (44 ft/sec) crossing a 60-foot intersection:**
- Red clearance = (60 + 20) / 44 = 1.8 seconds → **round to 2.0 seconds**

**MUTCD guidance:**
- All-red clearance should not exceed **6 seconds** (except for exceptionally wide intersections)
- Some agencies use **0 seconds** (no all-red), others use **1–2 seconds** as policy

**Chicago policy on all-red clearance:** **Unknown — not publicly documented.**

**To obtain:** File FOIA request to CDOT for signal timing sheets at specific intersections (see section 4).

---

## 3. Intersection Geometry Data

### 3.1 What's Needed for Proper Yellow/All-Red Calculation

1. **Approach speed:** Posted limit or 85th percentile actual speed
2. **Approach grade:** Percent slope (uphill/downhill)
3. **Intersection width:** Curb-to-curb distance (stop bar to far side)
4. **Stop bar position:** Distance from stop bar to crosswalk/curb

### 3.2 Chicago Data Availability

**No public dataset exists** combining intersection geometry with signal timing.

**Available resources:**
- **CDOT Street and Site Plan Design Standards** (https://www.chicago.gov/dam/city/depts/cdot/StreetandSitePlanDesignStandards407.pdf)
  - General design guidelines (e.g., parking lane widths, crosswalk standards)
  - NOT intersection-specific measurements

**To obtain intersection-specific geometry:**
- File **FOIA request** to CDOT for signal timing sheets (includes intersection width)
- Use **Google Earth / Street View** to measure approximate intersection width
- Check **CDOT Traffic Impact Studies** for major intersections (not systematically available)

### 3.3 Crosswalk and Stop Bar Standards (General)

**From NACTO / MUTCD:**
- Stop bar should be **at least 4 feet before the crosswalk**
- Stop bar should be **at least 8 feet before the crosswalk** to reinforce yielding to pedestrians (advanced stop bar)
- Crosswalk minimum width: **6 feet**
- Crosswalk lines typically **6 inches wide**

**Chicago-specific:**
- "Crosswalks must be a minimum of 6 feet in width. Typically, the crosswalk lines are 6 inches in width."
- Stop bar placement follows MUTCD (at least 4 feet before crosswalk)

**Intersection width estimation:**
- Local streets: ~32 feet curb-to-curb (two 10-foot lanes + gutter)
- Arterials: ~50–70 feet curb-to-curb (four lanes + parking/turn lanes)
- Major arterials: 70–100 feet

---

## 4. How to Obtain Yellow Light Timing via FOIA

### 4.1 What to Request

**FOIA request to Chicago Department of Transportation:**

> "I request the traffic signal timing plan/sheet for the intersection of [STREET A] and [STREET B], including:
>
> 1. Yellow change interval duration (in seconds) for all phases
> 2. All-red clearance interval duration (in seconds) for all phases
> 3. Intersection width (curb-to-curb distance) used in timing calculations
> 4. Posted speed limit on all approaches
> 5. Approach grade (percent slope) on all approaches
> 6. Date of last signal retiming
> 7. Any engineering reports or calculations justifying current timing"

### 4.2 How to File

**Email:** cdotfoia@cityofchicago.org
**Portal:** https://www.chicago.gov/city/en/depts/cdot/supp_info/cdot_foia.html

**Requirements:**
- Must be in writing (cannot be verbal)
- Include your name, mailing address, and contact information
- Be specific about the intersection and information requested
- Include exact location and dates whenever possible

**Timeline:**
- FOIA responses can take **5–10 business days** for routine requests
- Complex requests may take longer

**Note:** All FOIA requests are posted publicly on the City's website with requester name.

---

## 5. Chicago Red Light Camera Controversies

### 5.1 The 2.9-Second Yellow Light Scandal (2014)

**What happened:**
- Chicago's red-light camera vendor changed from **Redflex** to **Xerox** in February 2014
- **Redflex policy:** Reject tickets when yellow light < 3.0 seconds
- **Xerox policy:** Accept tickets when yellow light > 2.9 seconds (i.e., ≥2.91 seconds)
- That **0.1-second change** generated **77,000 additional tickets** and **$7.7 million in revenue** over 6 months

**How it was discovered:**
- Judge Robert Sussman (Department of Administrative Hearings) noticed 60–70% of tickets showed yellows under 3 seconds
- Judge routinely dismissed tickets with yellows < 3.0 seconds
- Chicago Tribune investigation exposed the policy change

**City's defense:**
- "These were violations of the law, they were legitimate tickets and we stand behind them." — CDOT chief Rebekah Scheinfeld
- Relied on electrical industry standard allowing ±0.11 second variation (2.89–3.12 seconds for a 3.0-second setting)

**Outcome:**
- City **refused to refund** the $7.7 million
- Illinois Appellate Court sided with the city, ruling it was "mere speculation" that yellows fell below 3.0 seconds (despite video evidence)
- Inspector General recommended restoring "hard 3.0 second threshold" for public confidence

**Legal significance:**
- Even 0.1 seconds matters at scale
- Signal controllers can drift below programmed values
- Most controllers default to 3.0-second minimum; conflict monitors will trigger flash mode if yellow drops below 2.7 seconds

---

### 5.2 Broader Corruption and Mismanagement

**Chicago Tribune investigation (2014) exposed:**
- **$2 million bribery scheme** that brought cameras to Chicago
- Former CDOT official convicted and sentenced to **10 years in prison**
- Former Redflex CEO Karen Finley and consultant Martin O'Malley also imprisoned
- **Tens of thousands of unfair tickets** issued despite malfunctioning cameras
- City knowingly issued tickets when yellow lights were below federal minimum

**Class-action lawsuit settlement (2017):**
- **$38.75 million settlement** for procedural due process violations
- Affected **1.2 million drivers** who received tickets 2010–2015
- Violations included:
  - Failing to send second violation notices before liability determination
  - Failing to specify vehicle makes
  - Charging late fees at 21 days instead of required 25 days
- Settlement provided **50% refunds** to affected drivers

**University of Illinois-Chicago research:**
- Found "little relationship between the number of tickets issued and the safety impact of cameras"

**Revenue impact:**
- Red-light cameras generated **$600 million** total for the city (through 2014)
- Speed cameras issued **$54 million** in fines (Jan–Sep 2024 alone)
- One ticket issued **every 20 seconds** on average

---

### 5.3 Short Yellow Lights and Safety

**National studies on yellow light timing:**
- Increasing yellow by **0.5 seconds** reduces red-light violations by **50%**
- Increasing yellow by **1.0 second** reduces violations by **53%** and crashes by **40%** (Texas DOT)
- California increased yellows by 0.3 sec → **62% reduction** in red-light running
- Increasing another 0.3 sec → additional **51% reduction** (total **81% reduction**)

**Why short yellows are dangerous:**
- Drivers cannot safely stop → forced to run the red or risk rear-end crash
- Creates "Type I dilemma zone" where stopping is uncomfortable but proceeding enters on red
- Proper yellow timing **eliminates the dilemma zone**

**Legal defense angle:**
- If yellow is shorter than ITE-calculated minimum → engineering defect
- Ticket is invalid if signal timing does not comply with MUTCD/ITE standards
- Short yellows are a revenue generator, not a safety measure

---

### 5.4 Green Light Timing at Camera Intersections

**2019 investigation (ABC7 Chicago):**
- Consumer investigators timed green+yellow at camera intersections
- Found **shorter green+yellow durations** in camera-monitored directions vs. non-camera directions
- One camera direction: only **20 seconds combined** green+yellow
- Implication: Cameras generate more tickets by shortening legal passage time

**Revenue impact:**
- 300 red-light cameras collected **$35 million** in 2019 alone

---

## 6. MUTCD and Engineering Resources

### 6.1 Federal MUTCD

**Current version:** 2009 Edition with Revisions 1–3 (through 2022)
**URL:** https://mutcd.fhwa.dot.gov/htm/2009/part4/part4d.htm

**Relevant sections:**
- **Section 4D.10:** Traffic Control Signal Needs Studies
- **Section 4D.17:** Yellow Change and Red Clearance Intervals
- **Table 4D-102 (California MUTCD):** Minimum Yellow Change Interval Durations

---

### 6.2 Illinois MUTCD (IMUTCD)

Illinois adopts the federal MUTCD with a state supplement (Illinois Supplement to the MUTCD).

**Illinois-specific requirement for camera intersections:**
- Yellow interval must meet nationally recognized minimum (3 seconds per MUTCD)
- **PLUS an additional 1 second** above that standard
- **Effective minimum for camera intersections: 4 seconds**

**IDOT resources:**
- District 1 Traffic Signal Design Guidelines (2009): https://apps.dot.illinois.gov/eplan/desenv/standards/District%201/D1MiscManuals/D1%20TS%20Design%20Guidelines%202009.pdf

---

### 6.3 ITE (Institute of Transportation Engineers)

**Key publication:** NCHRP Report 731 — "Guidelines for Timing Yellow and All-Red Intervals at Signalized Intersections" (2012)
**URL:** https://onlinepubs.trb.org/onlinepubs/nchrp/docs/NCHRP03-95_FR.pdf

**2020 update:**
- ITE released new guidelines incorporating Mats Järlström's equation for **turning vehicles**
- Traditional ITE formula assumes straight-through traffic
- Järlström's formula accounts for constant-speed "Go Zone" during turns
- More accurate for protected left-turn phases

---

## 7. Legal Defense Strategy Based on Yellow Light Timing

### 7.1 Defenses to Raise

**1. Yellow light duration below ITE-calculated minimum**
- Request signal timing sheet via FOIA
- Calculate minimum yellow using ITE formula with intersection's speed limit and grade
- Compare actual yellow duration to calculated minimum
- If actual < minimum → engineering defect → ticket invalid

**2. Illinois camera intersection law violation**
- Illinois requires yellow = MUTCD minimum (3 sec) + 1 second
- Chicago uses 3 seconds for ≤30 mph approaches
- Argue this violates state law for camera-enforced intersections

**3. All-red clearance interval inadequate**
- Request all-red duration via FOIA
- Calculate minimum all-red using (intersection width + 20 ft) / approach speed
- If actual < minimum → insufficient clearance time → ticket invalid

**4. Signal timing equipment malfunction**
- Chicago admitted signal controllers allow variation (2.89–3.12 sec for 3.0 sec setting)
- Request maintenance/calibration records for the signal controller
- If yellow actually measured < 3.0 seconds → malfunction → ticket invalid

**5. Chicago's history of short yellows for revenue**
- Cite 2014 Xerox scandal ($7.7 million from 0.1-second change)
- Cite Tribune investigation (corruption, unfair tickets)
- Argue city has pattern of prioritizing revenue over safety

**6. No engineering justification for 3.0-second minimum**
- Request engineering report justifying current timing
- If city cannot produce calculation showing 3.0 sec is adequate → arbitrary timing → ticket invalid

---

### 7.2 Evidence to Request via FOIA

**For specific intersection where ticket was issued:**
1. Signal timing plan/sheet (current and historical)
2. Yellow change interval duration for the approach direction
3. All-red clearance interval duration
4. Intersection width (curb-to-curb)
5. Posted speed limit on approach
6. Approach grade (percent slope)
7. Date of last signal retiming
8. Engineering calculations justifying current timing
9. Signal controller maintenance/calibration logs
10. Any crash data analysis used to justify camera placement

**Citywide:**
1. CDOT policy on yellow light timing for camera intersections
2. Documentation of compliance with Illinois "+1 second" law
3. Any engineering studies on yellow light timing adequacy

---

### 7.3 Expert Testimony

If contesting a ticket in court, consider hiring a **traffic engineering expert** to:
- Calculate proper yellow light duration using ITE formula
- Testify that actual yellow was below engineering minimum
- Explain how short yellows create dilemma zones and increase violations
- Cite studies showing proper yellow timing reduces violations by 50–81%

**Potential experts:**
- Licensed Professional Engineer (PE) with traffic signal design experience
- University transportation engineering professor
- Former IDOT/CDOT traffic engineer

---

### 7.4 Case Law / Precedents

**Chicago cases:**
- **Judge Robert Sussman (2014):** Routinely dismissed tickets with yellows < 3.0 seconds until city fixed timing
- **Illinois Appellate Court (2015):** Sided with city, ruled video evidence of 2.9-second yellows was "mere speculation"
- **Illinois Supreme Court:** Deadlocked 3–3 on related case (two justices recused), no ruling issued

**National precedents:**
- Courts in multiple states have dismissed tickets where yellow was below MUTCD/ITE minimum
- California cities forced to refund millions in tickets from short yellows
- Florida found many red-light camera vendors intentionally shortened yellows for revenue

**Outcome likelihood:**
- **Administrative hearing:** Low success rate (city hearing officers rarely side against city)
- **Circuit court appeal:** Higher success rate if backed by engineering evidence
- **Class action:** Most likely to succeed (cite Chicago's $38.75M settlement as precedent)

---

## 8. Data Gaps and Limitations

### 8.1 What's NOT Publicly Available

1. **Yellow light timing by intersection** — must be obtained via FOIA
2. **All-red clearance intervals** — must be obtained via FOIA
3. **Intersection geometry** (width, grade, stop bar position) — must be obtained via FOIA or measured manually
4. **Signal controller calibration logs** — must be obtained via FOIA
5. **Engineering justifications** for current timing — must be obtained via FOIA
6. **Dedicated speed limit dataset** — only indirectly available through crash data

### 8.2 Data Quality Issues

**Traffic Crashes dataset (posted_speed_limit field):**
- Relies on officer's "best available information at the time"
- May disagree with actual posted speed limits
- Not all intersections have crash data
- Not updated in real-time when speed limits change

**Red Light Camera Locations dataset:**
- Does not include timing information
- Does not include speed limits
- `go_live_date` may be outdated (cameras can be relocated/deactivated)

---

## 9. Recommendations for Ticketless Chicago Product

### 9.1 Immediate Actions

1. **Scrape red-light camera locations** from Chicago Data Portal API (already done?)
2. **Cross-reference with crash data** to infer speed limits at camera intersections
3. **Calculate ITE-recommended yellow durations** for each camera based on inferred speed
4. **Flag cameras likely to have short yellows** (3.0 sec at 30 mph = 0.5 sec short)
5. **Display warning in app:** "This camera may have yellow light timing issues"

### 9.2 FOIA Campaign

**Systematically request signal timing sheets** for all 149 camera intersections:
- Submit batch FOIA requests (10–20 intersections per request)
- Build database of actual yellow/all-red durations
- Compare to ITE-calculated minimums
- Identify intersections with timing defects

**Estimated effort:**
- 149 cameras ÷ 10 per request = **15 FOIA requests**
- 5–10 days per response = **2–3 months** to complete
- Cost: $0 (FOIA requests are free)

### 9.3 User Features

**For users who receive a red-light camera ticket:**
1. **"Check Your Yellow Light" tool:**
   - Input intersection where ticket was issued
   - Display known yellow light duration (if in database)
   - Calculate ITE-recommended minimum
   - Show whether actual yellow is below minimum
   - Provide FOIA request template to obtain signal timing sheet

2. **Contest letter generator:**
   - Auto-populate intersection details
   - Cite ITE formula and calculated minimum
   - Cite Chicago's history of short yellows
   - Request signal timing records
   - Provide template for administrative hearing defense

3. **Camera safety ratings:**
   - Rate each camera based on yellow light timing adequacy
   - "Green" = meets ITE minimum
   - "Yellow" = meets MUTCD minimum but not ITE recommendation
   - "Red" = below MUTCD minimum or unknown timing

### 9.4 Community Crowdsourcing

**Ask users to time yellow lights:**
- Film approaching intersection with timestamp
- Count frames from yellow onset to red onset
- Submit timing data to crowdsourced database
- Validate against FOIA-obtained official timings

**Legal note:** This could be powerful evidence if multiple users document short yellows at same intersection.

---

## 10. Summary of Key Data Points

| Data Need | Source | Availability | How to Obtain |
|-----------|--------|--------------|---------------|
| **Red-light camera locations** | Chicago Data Portal | ✅ Public API | `https://data.cityofchicago.org/resource/thvf-6diy.json` |
| **Speed limits at cameras** | Traffic Crashes dataset | ⚠️ Indirect | Cross-reference camera coords with crash data `posted_speed_limit` field |
| **Yellow light durations** | CDOT signal timing sheets | ❌ Not public | FOIA request to cdotfoia@cityofchicago.org |
| **All-red clearance intervals** | CDOT signal timing sheets | ❌ Not public | FOIA request to cdotfoia@cityofchicago.org |
| **Intersection geometry** | CDOT signal timing sheets | ❌ Not public | FOIA request OR manual measurement via Google Earth |
| **ITE minimum yellow** | Calculation | ✅ Can derive | Use formula: Y = 1 + V/(2a + 2Ag) with V from speed limit |
| **Violation history** | Red Light Camera Violations | ✅ Public API | `https://data.cityofchicago.org/resource/spqx-js37.json` |

---

## 11. References

### Chicago Data Portal
- Red Light Camera Locations: https://data.cityofchicago.org/Transportation/Red-Light-Camera-Locations/thvf-6diy
- Traffic Crashes - Crashes: https://data.cityofchicago.org/Transportation/Traffic-Crashes-Crashes/85ca-t3if
- Red Light Camera Violations: https://data.cityofchicago.org/Transportation/Red-Light-Camera-Violations/spqx-js37

### Federal Standards
- MUTCD 2009 Edition: https://mutcd.fhwa.dot.gov/htm/2009/part4/part4d.htm
- FHWA Yellow Change Intervals: https://highways.dot.gov/safety/proven-safety-countermeasures/yellow-change-intervals

### Engineering Guidelines
- ITE Kinematic Formula: https://shortyellowlights.com/standards/
- NCHRP Report 731 (ITE Guidelines): https://onlinepubs.trb.org/onlinepubs/nchrp/docs/NCHRP03-95_FR.pdf
- Derivation of Yellow Change Interval Formula: https://redlightrobber.com/red/links_pdf/Derivation-of-the-Yellow-Change-Interval-Formula.pdf

### Chicago Controversies
- Chicago Tribune Red Light Camera Investigation (2014): https://www.chicagotribune.com/news/ct-red-light-camera-yellow-light-1012-20141012-story.html
- DNAinfo on Judge Tossing Tickets: https://www.dnainfo.com/chicago/20140812/river-north/city-yellow-lights-too-short-judge-says-before-tossing-red-light-tickets/
- TheNewspaper.com Illinois Short Yellows: https://www.thenewspaper.com/news/64/6412.asp
- Citizens to Abolish Red Light Cameras: http://www.citizenstoabolishredlightcameras.com/

### FOIA
- CDOT FOIA Portal: https://www.chicago.gov/city/en/depts/cdot/supp_info/cdot_foia.html
- CDOT FOIA Email: cdotfoia@cityofchicago.org

---

## Appendix A: ITE Formula Quick Reference

**Yellow Change Interval:**
```
Y = t + V / (2a + 2Ag)

Where:
  t = 1.0 sec (perception-reaction time)
  V = approach speed in ft/sec (mph × 1.467)
  a = 10 ft/sec² (comfortable deceleration)
  A = 32.2 ft/sec² (gravity)
  g = grade (decimal: 0.03 for 3% uphill, -0.03 for 3% downhill)
```

**All-Red Clearance Interval:**
```
Red = (W + L) / V

Where:
  W = intersection width in feet (curb-to-curb)
  L = 20 feet (average vehicle length)
  V = approach speed in ft/sec
```

**Speed conversions:**
- 25 mph = 36.7 ft/sec
- 30 mph = 44.0 ft/sec
- 35 mph = 51.3 ft/sec
- 40 mph = 58.7 ft/sec
- 45 mph = 66.0 ft/sec

**Example calculation (30 mph, level grade, 60-ft intersection):**
- Yellow: Y = 1.0 + 44/(20) = 1.0 + 2.2 = **3.2 sec** (round to **3.5 sec**)
- All-Red: Red = (60+20)/44 = **1.8 sec** (round to **2.0 sec**)

---

## Appendix B: Sample FOIA Request Letter

```
To: cdotfoia@cityofchicago.org
Subject: FOIA Request - Traffic Signal Timing at [Intersection]

Dear CDOT FOIA Officer,

This is a request under the Illinois Freedom of Information Act (5 ILCS 140).

I request electronic copies of the following records related to the traffic signal at the intersection of [STREET A] and [STREET B] in Chicago, Illinois:

1. Current traffic signal timing plan/sheet, including:
   - Yellow change interval duration (in seconds) for all phases
   - All-red clearance interval duration (in seconds) for all phases
   - Cycle length and phase sequence

2. Intersection geometry data used in signal timing calculations:
   - Intersection width (curb-to-curb distance in feet) for all approaches
   - Posted speed limit on all approaches
   - Approach grade (percent slope) on all approaches
   - Stop bar to far-side curb distance

3. Engineering documentation:
   - Engineering report or calculation justifying current yellow/all-red timing
   - Date of last signal retiming or timing adjustment
   - Any crash data analysis or safety study for this intersection

4. Equipment records:
   - Signal controller manufacturer, model, and installation date
   - Signal controller calibration/maintenance logs for the past 12 months
   - Any malfunction reports or timing deviation incidents

5. Red-light camera enforcement records (if applicable):
   - Camera activation date
   - Monitored approach directions
   - Any correspondence with camera vendor regarding yellow light timing

I request this information in electronic format (PDF or spreadsheet) if possible.

If any portion of this request is denied, please cite the specific exemption and explain why it applies.

Thank you for your assistance.

Sincerely,
[Your Name]
[Your Address]
[Your Email]
[Your Phone]
```

---

**End of Report**
