# PARKING TICKET CONTESTATION DATA SOURCES - QUICK REFERENCE
## One-page Summary of All Evidence Available

**Last Updated:** 2026-02-12  
**Full Reference:** See `COMPREHENSIVE_DATA_SOURCES_INVENTORY.md` for detailed documentation

---

## CRITICAL EVIDENCE (Directly Proves Defense)

### 1. **Parking Location & Movement History**
- **What:** GPS-tracked parking sessions with departure timestamps
- **Proves:** User was NOT parked at ticket location / DID depart before ticket issued
- **Data Points:** parked_at, departed_at, latitude, longitude, duration, address
- **Status:** ACTIVE - Core mobile app feature

### 2. **Weather Data** (Historical)
- **What:** Temperature, precipitation, snow accumulation, wind, visibility
- **Proves:** Weather cancelled street cleaning / Snow threshold not met
- **Applications:** Street Cleaning (9-64-010), Snow Routes (9-64-100), Bike Lane (9-64-090)
- **Status:** ACTIVE - National Weather Service + OpenWeatherMap APIs
- **Coverage:** Chicago, 7-30 days historical

### 3. **City Sticker Receipts**
- **What:** Email captures of SEBIS purchase receipts
- **Proves:** User PAID for city sticker (defeats "no sticker" violations)
- **Data:** sender_email, forwarded_at, file_path, email_subject
- **Status:** ACTIVE - Users forward bills to unique email address

### 4. **Registration Evidence Receipts**
- **What:** License plate & city sticker emails + OCR extraction
- **Proves:** Vehicle registered/owned at time of violation
- **Data:** source_type, parsed_purchase_date, parsed_order_id, parsed_amount_cents
- **Status:** ACTIVE - Dual-purpose for city sticker + license plate violations

### 5. **Court Outcomes & Hearing Officer Data**
- **What:** Historical FOIA case data, officer dismissal rates, ward win rates
- **Proves:** What defense arguments/evidence work in your ward/with your officer
- **Data:** overall_dismissal_rate, defense_acceptance, evidence_preferences, strictness_score
- **Status:** ACTIVE - Built into letter generation AI

---

## VERY HIGH VALUE EVIDENCE (Strongly Supports Defense)

### 6. **Camera Pass History**
- **What:** GPS timestamps when user passed speed/red light cameras
- **Proves:** User was elsewhere at time of ticket (proves alibi)
- **Data:** passed_at, camera_latitude, camera_longitude, user_speed_mph, expected_speed_mph
- **PROBLEM:** Currently UNDERUTILIZED - rarely referenced in letters
- **Opportunity:** Implement automatic geo-fence conflict detection

### 7. **Red Light Camera Receipts**
- **What:** Detailed speed/stopping data with second-by-second trace
- **Proves:** User DID fully stop OR was below speed limit
- **Key Fields:** full_stop_detected, trace (JSONB with velocity curves)
- **PROBLEM:** `trace` field LARGELY UNEXPLORED
- **Opportunity:** Parse trace data for technical defense arguments

### 8. **Signage Reports Database**
- **What:** Community-reported sign conditions (faded, damaged, obscured, missing)
- **Proves:** Sign was illegible = ticket invalid
- **Data:** condition, obstruction_type, photo_urls, contest_win_rate
- **Status:** ACTIVE but UNDERUTILIZED - growing community database
- **Opportunity:** Geospatial query to auto-surface relevant nearby signs

### 9. **Street Cleaning Schedule**
- **What:** Historical daily cleaning schedule by block
- **Proves:** Street cleaning actually happened (or didn't) on ticket date
- **Status:** ACTIVE - Core to street cleaning defense

---

## HIGH PRIORITY EVIDENCE (Supporting/Contextual)

### 10. **FOIA Request System** ⭐ CRITICAL OPPORTUNITY
- **What:** Table structure exists to queue & track FOIA requests
- **Can Obtain:** Original city ticket, officer notes, photos, camera calibration, maintenance logs
- **Status:** EMERGING - **Infrastructure built but process NOT implemented**
- **Impact:** Could dramatically improve defense quality by accessing city's own evidence
- **Action Needed:** Build automated FOIA request workflow

### 11. **Utility Bills** (OCR Extracted)
- **What:** ComEd, Peoples Gas, water bills forwarded as emails
- **Proves:** Residency at address (for residential permit & city sticker defenses)
- **Data:** parsed service address, account holder, billing dates
- **Status:** ACTIVE - Auto-OCR extraction

### 12. **Permit Zone Geometries**
- **What:** PostGIS polygons of exact permit zone boundaries
- **Proves:** Location is/isn't in permit zone
- **Source:** Chicago Data Portal (regularly synced)
- **Status:** ACTIVE

### 13. **Snow Routes & Winter Restrictions**
- **What:** PostGIS geometries of snow routes, emergency declarations
- **Proves:** Threshold not met or user had proper warning
- **Status:** ACTIVE

---

## SUPPORTING EVIDENCE (Medium Value)

| Source | Proves | Status |
|--------|--------|--------|
| Vehicle Registration | Correct vehicle cited | ACTIVE |
| User Addresses | Residency for permit violations | ACTIVE |
| Detected Tickets | Core ticket details | ACTIVE |
| Contest Letters | Generated argument & evidence | ACTIVE |
| Evidence Analysis OCR | Extracted data from photos/docs | ACTIVE |
| Letter Quality Scores | Predicted win probability | ACTIVE |
| Contest Outcomes | Historical learning data | ACTIVE |
| Red/Speed Camera Reference | Camera location confirmation | ACTIVE |

---

## DATA SOURCES NOT YET USED FOR CONTESTS

| Source | Why Not | Potential |
|--------|--------|-----------|
| **Towed Vehicles** | Alert system only | Could prove enforcement patterns |
| **Email Logs** | Operational only | Could prove user received warnings |
| **SMS Logs** | Operational only | Could prove notification delivery |

---

## KEY STATISTICS

- **Total Data Sources:** 24+
- **Currently Active:** 70-80%
- **Underutilized:** 15-20%
- **Ready to Implement:** FOIA system infrastructure
- **High-Priority Expansions:** 4 (camera timeline, trace data, signage geo-query, FOIA workflow)

---

## RECOMMENDED EXPANSION PRIORITIES

### IMMEDIATE (Next Sprint)
1. **FOIA Request Automation** - Infrastructure exists, just needs workflow
2. **Camera Pass History Timeline Conflicts** - Prove user was elsewhere
3. **Red Light Trace Data Parsing** - Prove stop/speed compliance

### SHORT TERM (Next Quarter)
4. **Signage Reports Geospatial Query** - Auto-surface nearby sign defects
5. **Evidence Analysis Improvements** - Better OCR, more evidence types

### LONG TERM (Ongoing)
6. **Towed Vehicle Pattern Analysis** - Show enforcement disparities
7. **Advanced Machine Learning** - Use contest outcomes for better recommendations

---

## TECHNICAL REFERENCE

### Core Supabase Tables
```
detected_tickets → contest_letters
            ↓
    parking_location_history
    camera_pass_history
    red_light_receipts
    city_sticker_receipts
    registration_evidence_receipts
            ↓
    signage_reports
    street_cleaning_schedule
    snow_routes
    parking_permit_zones
            ↓
    ward_contest_intelligence
    hearing_officer_patterns
    contest_outcomes
```

### Storage Buckets
- `ticket_photos` - Evidence uploads
- `evidence_uploads` - Documents
- `residency_proofs` - Residency docs
- `registration_documents` - License, registration, insurance

### PostGIS Spatial Tables
- `parking_permit_zones` - Zone boundaries
- `snow_routes` - Snow route geometries
- `signage_reports` - Sign locations

---

## HOW TO USE THIS REFERENCE

1. **For Letter Generation:** Use Tiers 1-2 (critical + very high value)
2. **For Hearing Strategy:** Use Tier 1 section 5 (court outcomes & officer patterns)
3. **For Defense Expansion:** Focus on "Underutilized" opportunities in Tier 2
4. **For Platform Improvement:** See "Key Expansion Priorities" section

---

**For complete details:** See `COMPREHENSIVE_DATA_SOURCES_INVENTORY.md`
