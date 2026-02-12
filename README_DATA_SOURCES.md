# Data Sources Inventory - README

This directory contains comprehensive documentation of all data sources available in the Ticketless America system that can be used to support parking ticket contestation.

## Quick Navigation

### For Quick Reference
- **START HERE**: [`DATA_INVENTORY_SUMMARY.txt`](DATA_INVENTORY_SUMMARY.txt) - 1-page executive summary with key findings

### For Detailed Information
- **FULL INVENTORY**: [`DATA_SOURCES_INVENTORY.md`](DATA_SOURCES_INVENTORY.md) - 833-line comprehensive breakdown of all 18 data sources with field-by-field details

### For Developer Reference
- **CODE LOCATIONS**: [`DATA_SOURCES_CODE_LOCATIONS.md`](DATA_SOURCES_CODE_LOCATIONS.md) - Where each data source is accessed in the codebase

---

## What's Inside?

### 18 Major Data Sources Documented

1. **Email & Receipt Forwarding** (3 sources)
   - City sticker purchase receipts
   - Registration evidence (license plate + city sticker)
   - Red light camera receipts

2. **Parking Detection & Location** (3 sources)
   - Parking history (GPS-verified)
   - Saved parked locations
   - Camera pass history

3. **Weather & Environmental** (3 sources)
   - Historical weather data (free NWS API)
   - Street cleaning schedule
   - Snow routes & winter restrictions

4. **Court & Hearing Officer Intelligence** (4 sources)
   - Ward contest intelligence
   - Hearing officer patterns
   - Signage database
   - FOIA requests (emerging)

5. **User Vehicle & Registration** (2 sources)
   - User profiles (vehicle info)
   - User addresses (residency proof)

6. **Evidence & Documents** (3 sources)
   - User-uploaded evidence
   - Residency proof documents
   - Vehicle registration documents

7. **Ticket & Contest Tracking** (3 sources)
   - Detected tickets
   - Ticket contests
   - Contest letters

8. **Financial & Utility** (1 source)
   - Utility bills (via email forwarding)

9. **Signage & Street** (2 sources)
   - Permit zone geometries (PostGIS)
   - Snow routes (PostGIS)

10. **Messaging & Logs** (2 sources)
    - Email logs
    - SMS logs

11. **Towed Vehicles** (1 source)
    - Towed vehicle patterns

12. **Autopilot & Automation** (2 sources)
    - Portal scraper
    - Autopilot letter generation queue

---

## Key Findings

### Critical Data Sources (Essential for Contest Letters)

**Currently ACTIVE and properly utilized:**
- Parking history (departure proof)
- Weather data (weather-based defenses)
- City sticker receipts (ownership proof)
- Registration evidence (vehicle registration)
- Street cleaning schedule (schedule verification)

### Highly Valuable but UNDER-UTILIZED

**These have significant evidence value but are rarely used:**

1. **Camera Pass History** - Location/timestamp data
   - Could prove user was elsewhere during ticket time
   - Needs: Automatic location/time overlap detection

2. **Red Light Receipt Traces** - Speed/behavior data
   - Contains second-by-second GPS + speed history
   - Unused field: `trace` (JSONB)
   - Could prove full stop or below-speed-limit compliance
   - Needs: JSONB trace parsing

3. **Signage Reports** - Community crowdsourced data
   - User-reported sign conditions (faded, damaged, obscured, missing)
   - High win rate when sign is referenced
   - Needs: Geospatial query to find signs near ticket location

### Emerging Opportunities

**Infrastructure exists but not fully implemented:**
- **FOIA Requests**: Table created, ready for implementation
  - Could obtain city's own evidence (officer notes, photos, calibration)
  - Action: Implement auto-FOIA generation post-contest

- **Ward Intelligence**: Data exists, minimal usage
  - Could tailor arguments by ward/officer
  - Action: Expand personalization

- **Towed Vehicles**: Currently alerts-only
  - Could support enforcement pattern arguments
  - Action: Correlate with ticket statistics

---

## How to Use This Documentation

### If you're implementing a new feature
1. Check `DATA_SOURCES_INVENTORY.md` for what data is available
2. Check `DATA_SOURCES_CODE_LOCATIONS.md` for where to access it
3. Review the "Current Usage" and "Potential" sections

### If you're optimizing contest letters
1. Read `DATA_INVENTORY_SUMMARY.txt` for priority areas
2. Review "Opportunities for Letter Quality Improvement" section
3. Check recommended phased implementation roadmap

### If you're troubleshooting a data issue
1. Find the specific data source in `DATA_SOURCES_CODE_LOCATIONS.md`
2. Check API endpoints, tables, and code locations listed
3. Review migration files and database schema

---

## Data Sources by Evidence Value

### CRITICAL (Contest letter weak without this)
- Parking history
- Weather data
- City sticker receipts
- Registration evidence
- Street cleaning schedule

### VERY HIGH (Significant impact when available)
- Camera pass history
- Red light receipts

### HIGH (Strategic value, shapes argument)
- Ward intelligence
- Hearing officer patterns
- Court case outcomes

### MEDIUM (Supporting evidence)
- User addresses
- Permit zones
- Signage reports
- User profiles

### LOW (Operational, not contest-focused)
- Email logs
- SMS logs
- Towed vehicles

---

## Currently Unused Data (Expansion Opportunities)

### Camera Pass History Timeline
**Status**: Data collected, not analyzed
**Opportunity**: Prove user at different location during ticket time
**Action**: Add geospatial/temporal overlap checking

### Red Light Receipt Trace JSONB
**Status**: Summary fields used, trace field ignored
**Opportunity**: Technical defense (speed/stopping behavior)
**Action**: Parse JSONB trace data for detailed analysis

### Signage Reports Geospatial Data
**Status**: Data collected, not queried
**Opportunity**: Find nearby sign conditions (faded/obscured/missing)
**Action**: Implement PostGIS spatial join

### Towed Vehicles Pattern Data
**Status**: Alert-only usage
**Opportunity**: Selective enforcement arguments
**Action**: Correlate with ticket/ward statistics

### Hearing Officer Evidence Preferences
**Status**: Data exists, not personalized
**Opportunity**: Tailor evidence presentation
**Action**: Customize by officer in letter generation

---

## Implementation Roadmap

### Immediate (2 weeks)
1. Add camera pass history timeline to letters
2. Expand weather condition language
3. Add geospatial signage database lookup

### Short Term (1 month)
1. Parse red light receipt traces
2. Generate FOIA requests post-contest
3. Add tow enforcement statistics

### Medium Term (2-3 months)
1. Ward-specific argument optimization
2. Hearing officer preference adaptation
3. User-facing evidence collection guidance

### Long Term
1. ML-based evidence relevance scoring
2. Predictive evidence collection
3. Outcome feedback loop

---

## Technical Details

### Database Tables (Supabase)
- `ticket_contests` - Contest tracking
- `detected_tickets` - Discovered tickets
- `contest_letters` - Generated letters
- `city_sticker_receipts` - Forwarded receipts
- `registration_evidence_receipts` - OCR-extracted evidence
- `camera_pass_history` - Speed camera passes
- `red_light_receipts` - Red light camera traces
- `street_cleaning_schedule` - Daily cleaning schedule
- `snow_routes` - Snow emergency routes
- `parking_permit_zones` - Permit zone boundaries
- `signage_reports` - User-reported signs
- `ward_contest_intelligence` - Ward win rates
- `hearing_officer_patterns` - Officer patterns
- `ticket_foia_requests` - FOIA request tracking
- `towed_vehicles` - Towed vehicle records

### External APIs
- National Weather Service (free, no auth required)
- Chicago portal scraper (proprietary)
- Cook County API

### Storage Buckets
- `ticket_photos` - Evidence uploads
- `registration_documents` - Vehicle docs
- `residency_proofs` - Address proofs

---

## Mobile App Data Collection

### iOS
- **Parking**: CoreLocation + CMMotionActivityManager
- **Camera passes**: CoreLocation
- **Red light traces**: Full motion traces with GPS

### Android
- **Parking**: Bluetooth Classic + LocationManager
- **Camera passes**: LocationManager
- **Red light traces**: Full traces with speed data

---

## Files in This Documentation

| File | Size | Purpose |
|------|------|---------|
| `DATA_SOURCES_INVENTORY.md` | 833 lines | Complete breakdown |
| `DATA_INVENTORY_SUMMARY.txt` | ~150 lines | Executive summary |
| `DATA_SOURCES_CODE_LOCATIONS.md` | ~350 lines | Code reference |
| `README_DATA_SOURCES.md` | This file | Navigation guide |

---

## Questions?

If you need to:
- **Find a specific data source** → See `DATA_SOURCES_INVENTORY.md`
- **Find where code accesses data** → See `DATA_SOURCES_CODE_LOCATIONS.md`
- **Get high-level overview** → See `DATA_INVENTORY_SUMMARY.txt`
- **Understand implementation priorities** → See roadmap section above

---

## Last Updated

Generated: 2026-02-12

All data sources confirmed as of February 2026. Database schema from `lib/database.types.ts`, migrations from `/supabase/migrations/`.

