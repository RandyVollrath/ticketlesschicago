# Yellow Light Timing Quick Reference
## For Chicago Red-Light Camera Legal Defense

---

## The Bottom Line

**Chicago's yellow light timing is legally questionable:**
- Chicago uses **3.0 seconds** for ≤30 mph intersections
- ITE engineering standard recommends **3.5 seconds** for 30 mph
- Illinois law requires camera intersections to have **3 seconds + 1 second = 4 seconds minimum**
- Chicago's 2014 Xerox scandal: 0.1-second change generated **$7.7 million** in questionable tickets

---

## ITE Kinematic Formula (The Engineering Standard)

### Yellow Change Interval

```
Y = t + V / (2a + 2Ag)
```

**Standard parameters:**
- **t** = 1.0 sec (perception-reaction time)
- **a** = 10 ft/sec² (comfortable deceleration)
- **A** = 32.2 ft/sec² (gravity)
- **g** = grade as decimal (0.00 for level, 0.03 for 3% uphill, -0.03 for 3% downhill)
- **V** = approach speed in ft/sec

**Speed conversions:**
| MPH | ft/sec |
|-----|--------|
| 25  | 36.7   |
| 30  | 44.0   |
| 35  | 51.3   |
| 40  | 58.7   |
| 45  | 66.0   |

**Quick calculation for level intersections:**
- 25 mph: Y = 1.0 + 36.7/20 = **2.8 sec → round to 3.0 sec**
- 30 mph: Y = 1.0 + 44.0/20 = **3.2 sec → round to 3.5 sec**
- 35 mph: Y = 1.0 + 51.3/20 = **3.6 sec → round to 4.0 sec**
- 40 mph: Y = 1.0 + 58.7/20 = **3.9 sec → round to 4.0 sec**
- 45 mph: Y = 1.0 + 66.0/20 = **4.3 sec → round to 4.5 sec**

---

### All-Red Clearance Interval

```
Red = (W + L) / V
```

**Parameters:**
- **W** = intersection width (curb-to-curb in feet)
- **L** = 20 feet (average vehicle length)
- **V** = approach speed in ft/sec

**Example (30 mph crossing 60-ft intersection):**
- Red = (60 + 20) / 44 = **1.8 sec → round to 2.0 sec**

**Typical Chicago arterial intersections:**
- 50-ft width → ~1.6 sec all-red at 30 mph
- 60-ft width → ~1.8 sec all-red at 30 mph
- 70-ft width → ~2.0 sec all-red at 30 mph

---

## MUTCD Minimum Yellow Light Duration

| Speed Limit | MUTCD Minimum | ITE Recommended |
|-------------|---------------|-----------------|
| 25 MPH      | 3.0 sec       | 3.0 sec         |
| 30 MPH      | 3.0 sec       | 3.5 sec         |
| 35 MPH      | 3.5 sec       | 4.0 sec         |
| 40 MPH      | 4.0 sec       | 4.5 sec         |
| 45 MPH      | 4.5 sec       | 5.0 sec         |
| 50 MPH      | 5.0 sec       | 5.5 sec         |

**Note:** Chicago uses the bare MUTCD minimum (left column), not the ITE recommended values (right column).

---

## Chicago's Policy vs. Standards

| Jurisdiction | 30 MPH Yellow | 35 MPH Yellow | Notes |
|--------------|---------------|---------------|-------|
| **MUTCD (federal)** | 3.0 sec | 3.5 sec | Bare minimum |
| **ITE (engineering)** | 3.5 sec | 4.0 sec | Recommended |
| **Illinois (camera law)** | 4.0 sec | 4.5 sec | MUTCD + 1 sec |
| **Chicago (actual)** | 3.0 sec | 4.0 sec | MUTCD only |

**Legal issues:**
1. Chicago's 3.0-second yellow for 30 mph is **0.5 seconds short** of ITE recommendation
2. Chicago's 3.0-second yellow for camera intersections **violates Illinois law** (should be 4.0 sec minimum)

---

## Safety Impact of Proper Yellow Timing

| Yellow Increase | Red-Light Violation Reduction |
|-----------------|------------------------------|
| +0.3 seconds    | 62% reduction (California)   |
| +0.5 seconds    | 50% reduction (national)     |
| +0.6 seconds    | 81% reduction (California)   |
| +1.0 seconds    | 53% reduction + 40% crash reduction (Texas) |

**Implication:** Short yellows are a **revenue generator**, not a safety measure.

---

## Chicago Data Portal API Endpoints

### 1. Red Light Camera Locations
```
https://data.cityofchicago.org/resource/thvf-6diy.json
```

**Available fields:**
- `intersection` (e.g., "4413 W North Ave")
- `latitude` / `longitude`
- `first_approach` (e.g., "EB", "NB", "WB", "SB")
- `go_live_date`

**Example query (get all cameras):**
```bash
curl "https://data.cityofchicago.org/resource/thvf-6diy.json?$limit=1000"
```

---

### 2. Traffic Crashes (Speed Limit Data)
```
https://data.cityofchicago.org/resource/85ca-t3if.json
```

**Relevant fields:**
- `posted_speed_limit` (e.g., "30", "25", "35")
- `latitude` / `longitude`
- `traffic_control_device` (filter for "TRAFFIC SIGNAL")

**Example query (get crashes at traffic signals with speed limits):**
```bash
curl "https://data.cityofchicago.org/resource/85ca-t3if.json?\
$select=posted_speed_limit,latitude,longitude,intersection\
&$where=traffic_control_device='TRAFFIC SIGNAL'\
&$limit=1000"
```

**Strategy:**
1. Get all red-light camera coordinates from dataset #1
2. Query crashes within 100m of each camera from dataset #2
3. Extract `posted_speed_limit` field
4. Use most common speed limit value for that intersection

---

### 3. Red Light Camera Violations
```
https://data.cityofchicago.org/resource/spqx-js37.json
```

**Use case:** Analyze violation patterns, identify high-revenue cameras (may indicate short yellows).

---

## FOIA Request for Signal Timing

**Email:** cdotfoia@cityofchicago.org

**What to request:**
1. Traffic signal timing plan/sheet for [intersection]
2. Yellow change interval duration (in seconds) for all phases
3. All-red clearance interval duration (in seconds)
4. Intersection width (curb-to-curb) used in calculations
5. Posted speed limit on all approaches
6. Approach grade (percent slope)
7. Engineering calculations justifying current timing
8. Signal controller calibration/maintenance logs (past 12 months)

**Template:** See Appendix B in main research report.

**Response time:** 5–10 business days for routine requests.

---

## Legal Defense Checklist

**For a red-light camera ticket, check:**

- [ ] **Obtain signal timing sheet via FOIA**
  - Yellow duration for your approach direction
  - All-red clearance interval
  - Intersection width, speed limit, grade

- [ ] **Calculate ITE minimum yellow**
  - Use formula: Y = 1 + (speed in ft/sec) / 20
  - Round up to nearest 0.5 sec

- [ ] **Compare actual vs. minimum**
  - If actual < ITE minimum → engineering defect
  - If actual < 4.0 sec at camera intersection → Illinois law violation

- [ ] **Check for equipment malfunction**
  - Request controller calibration logs
  - Chicago admitted controllers vary ±0.11 sec (2.89–3.12 for 3.0 setting)
  - If measured yellow < 3.0 sec → malfunction

- [ ] **Research intersection history**
  - Check if intersection was involved in 2014 Xerox scandal
  - Check if intersection has high violation rate (may indicate short yellow)

- [ ] **Cite Chicago's corruption history**
  - $7.7 million from 0.1-second Xerox change
  - $2 million bribery scheme
  - $38.75 million class-action settlement for procedural violations

- [ ] **Request engineering justification**
  - Why is 3.0 sec adequate for 30 mph when ITE recommends 3.5 sec?
  - How does Chicago comply with Illinois "+1 second" law for cameras?

---

## Key Legal Precedents

### Chicago Cases
- **Judge Robert Sussman (2014):** Dismissed tickets with yellows < 3.0 seconds
  - "We're having a big problem with these yellow lights. 60–70% are coming up under three seconds."
  - Continued to dismiss tickets until city fixed timing

- **Illinois Appellate Court (2015):** Sided with city
  - Ruled video evidence of 2.9-sec yellows was "mere speculation"
  - Rescued city from $7.7 million in refunds

- **$38.75M Class Action Settlement (2017):**
  - 1.2 million affected drivers (2010–2015 tickets)
  - Refunded 50% of fines for procedural violations
  - Did NOT specifically address yellow light timing issues

### National Precedents
- **Florida, California, New Jersey:** Courts have dismissed tickets where yellow < MUTCD/ITE minimum
- **Texas DOT study:** Extending yellow by 1 sec → 53% fewer violations, 40% fewer crashes
- **Multiple states:** Cities forced to refund millions from deliberately shortened yellows

---

## Red Flags for Short Yellow Lights

**Indicators that an intersection may have inadequate yellow timing:**

1. **High violation rate** relative to traffic volume
2. **Chicago's 3.0-second standard** for 30 mph (0.5 sec short of ITE)
3. **Camera direction has shorter green+yellow** than non-camera directions
4. **Intersection added cameras after 2014** Xerox transition
5. **Intersection on arterial with 30 mph limit** (most likely to have 3.0 sec)
6. **Downhill approach** (needs longer yellow per ITE formula)
7. **Wide intersection** (>70 ft) with no all-red clearance

---

## Product Feature Ideas

### 1. "Yellow Light Audit" Tool
- User enters intersection where they got ticketed
- App queries Chicago Data Portal for speed limit (via crash data)
- App calculates ITE-recommended yellow using formula
- App compares to Chicago's policy (3.0 or 4.0 sec)
- App flags if timing is deficient
- App generates FOIA request for actual timing sheet

### 2. Camera Risk Ratings
- Rate each of Chicago's 149 cameras:
  - **Green:** Timing meets ITE recommendation
  - **Yellow:** Timing meets MUTCD but not ITE (questionable)
  - **Red:** Timing below MUTCD or unknown
- Display warning when user parks near a "Red" camera

### 3. Crowdsourced Yellow Timing
- Users film approaching intersection with timestamp
- Users count frames from yellow onset to red
- Users submit timing measurements
- App aggregates data and compares to FOIA-obtained official timings
- Build database of actual measured yellows citywide

### 4. Contest Letter Generator
- Auto-fill intersection details
- Calculate ITE minimum
- Cite Chicago's corruption history
- Include FOIA request template
- Provide administrative hearing defense script

---

## Key Takeaways

1. **Chicago's yellow lights are legally questionable** — 3.0 sec for 30 mph violates Illinois camera law
2. **0.1 seconds matters** — Xerox scandal proved $7.7M revenue from 0.1-sec change
3. **Proper yellow timing reduces violations by 50–81%** — short yellows are revenue generators, not safety measures
4. **Signal timing data is NOT public** — must FOIA each intersection individually
5. **Speed limits CAN be inferred** from Chicago's Traffic Crashes dataset (imperfect but usable)
6. **ITE formula is the engineering standard** — Chicago uses bare MUTCD minimum instead
7. **Legal defense is viable** — if yellow < ITE minimum, ticket may be invalid

---

## Resources

- **Main research report:** `CHICAGO_RED_LIGHT_CAMERA_DATA_RESEARCH.md`
- **Chicago Data Portal:** https://data.cityofchicago.org/
- **CDOT FOIA:** cdotfoia@cityofchicago.org
- **ITE Formula:** https://shortyellowlights.com/standards/
- **MUTCD:** https://mutcd.fhwa.dot.gov/
- **Citizens to Abolish Red Light Cameras:** http://www.citizenstoabolishredlightcameras.com/
