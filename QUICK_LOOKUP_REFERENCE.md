# Quick Lookup Reference: Automatic Data Sources

## At a Glance

**Total Data Sources: 22**
- Fully Built & Working: 17
- Partially Built: 3  
- Not Yet Started: 5+

---

## By Data Type

### Location & Geographic Data
- **Google Street View** - signage, conditions, multi-angle views
- **Permit Zones** - residential/industrial, restriction hours
- **Street Cleaning Zones** - ward, section, schedule
- **Snow Routes** - route names, activation status
- **Winter Ban Streets** - street list, ban hours
- **Red Light Cameras** - 100+ locations, approach directions
- **Speed Cameras** - 300+ locations, deployment dates
- **Signage Database** - crowdsourced condition reports

### Temporal Data
- **Historical Weather** - temp, precipitation, snow, wind, codes
- **Street Cleaning Schedule** - day of week, frequency
- **Permit Zone Hours** - time restrictions, grace periods
- **Hearing Officer Schedules** - dismissal patterns by violation type

### Case Intelligence Data
- **Hearing Officer Records** - dismissal rates, tendencies, strictness scores
- **Win Rate Statistics** - by violation code, ward, season, evidence type
- **Contest Outcomes** - historical results, evidence effectiveness
- **Evidence Guidance** - optimized questions, impact ranking, pitfalls

### User Evidence Data
- **Mobile App Parking History** - departure times, GPS accuracy, duration
- **Mobile App Restrictions** - what app detected when user parked
- **Parking Location Patterns** - visit frequency, familiar locations

### Legal & Administrative Data
- **Chicago Ordinances** - violation codes, requirements, exemptions
- **Cook County Records** - residency, property ownership
- **City Sticker Status** - purchase history, renewal dates
- **Tow Status** - location, fees, impound details

### Automated Defense Data
- **Weather Defense Paragraphs** - auto-generated legal arguments
- **Letter Quality Scores** - completeness, persuasiveness metrics

---

## By Violation Type

### Street Cleaning Violations
- Street cleaning schedule ✓
- Weather data ✓ → Auto-generates defense
- Signage reports ✓
- Mobile parking history ✓
- Win rates ✓ (~45-50%)

### Snow Route Violations  
- Snow route data ✓
- Weather data ✓
- Snow accumulation ✓
- Mobile parking history ✓
- Win rates ✓

### Permit Zone Violations
- Permit zone boundaries ✓
- Permit zone hours ✓
- Time validation ✓
- Mobile parking history ✓
- Cook County residency ✓
- Win rates ✓

### Expired Meter
- Meter locations ✓
- ParkChicago payment (partial)
- Mobile parking duration ✓
- Win rates ✓ (67%)

### Expired Plates
- Evidence guidance ✓ (75% win rate)
- Cook County records ✓
- IL SOS queries (not built)

### City Sticker
- City sticker status (partial)
- Residency verification ✓
- Grace period tracking (partial)
- Evidence guidance ✓ (70% win rate)

### Red Light/Speed Camera
- Camera locations ✓
- Camera operational dates ✓
- Hearing officer data ✓
- Camera video (not built)

### Towed Vehicle
- Tow status (partial)
- Impound locations ✓
- Fee calculations ✓
- Contest eligibility ✓

---

## By Input Required

### Address Only
- Street cleaning schedule
- Permit zone lookup
- Winter ban status
- Snow route status
- Signage database search
- Neighborhood risk

### Date Only
- Historical weather
- Win rate statistics by month
- Weather defense eligibility

### Address + Date
- ALL of the above

### Address + Date + Time
- Permit zone time validation
- Time-specific win rates

### GPS Coordinates
- More accurate Street View
- Better signage searches
- Precise distance calculations

### Violation Code
- Win rate statistics
- Hearing officer patterns
- Evidence guidance
- Ordinance lookup
- Letter generation

### License Plate + State
- Tow status lookup (if integrated)
- IL SOS registration (if integrated)

### Mobile App User (Premium)
- GPS parking history
- Departure proof
- Duration tracking
- Restriction detection

### Hearing Officer ID
- Track record analysis
- Defense recommendations
- Outcome prediction

---

## By Evidence Strength

### Highest Impact (45% weight)
- GPS departure proof (mobile app users)
- Signed receipts (city sticker, expired plates)
- Official records (weather, schedules)

### High Impact (20-30% weight)
- Hearing officer patterns
- Signage condition reports
- Mobile app restrictions data
- Parking history patterns

### Medium Impact (10-15% weight)
- Weather defense paragraphs
- Win rate statistics
- Evidence guidance
- Comparable case outcomes

### Supporting (5-10% weight)
- Neighborhood patterns
- Seasonal trends
- Camera locations
- Ordinance citations

---

## Integration Points

### API Integrations
- National Weather Service (NWS)
- Open-Meteo (historical weather)
- OpenWeatherMap (fallback)
- Google Maps/Street View
- Chicago Data Portal
- Cook County Assessor

### Database Tables
- `parking_location_history` (mobile app)
- `win_rate_statistics`
- `contest_outcomes`
- `hearing_officer_patterns`
- `signage_reports`
- `permit_zone_hours`
- `street_cleaning_schedules`
- `snow_route_status`
- `tow_boot_alerts`

### External Data Files
- `red-light-cameras.ts` (static)
- `speed-cameras.ts` (static)
- `chicago-ordinances.ts` (static)

---

## Response Time Targets

| Data Source | Response Time | Bottleneck |
|---|---|---|
| Permit zones | <50ms | Database query |
| Street cleaning | <100ms | GeoDB spatial query |
| Weather (cached) | <10ms | Cache hit |
| Weather (fresh) | 1-2s | API call |
| Street View | 500-800ms | Google API |
| FOIA statistics | <50ms | Database lookup |
| Mobile app history | <100ms | Database query |
| Camera locations | <5ms | In-memory array |
| Hearing officer data | <100ms | Database query |
| **Total letter generation** | **3-5 seconds** | Weather API |

---

## Failure Modes & Fallbacks

| Data Source | Failure | Fallback |
|---|---|---|
| Street View | API down | Use nearby/generalize |
| Weather (NWS) | API error | Try Open-Meteo |
| Weather (all APIs) | All fail | Use NOAA historical |
| Permit zones | Query error | Return "unknown" |
| Mobile history | User no data | Skip GPS evidence |
| Hearing officer | No record | Use base rates |
| Win rates | No data | Use 30% default |

---

## Cost Analysis

| Data Source | Cost | Volume |
|---|---|---|
| Street View | $7 per 1k | Free tier: 28.5k/mo |
| Weather | Free | Unlimited (NWS) |
| Coordinates | Free | Unlimited |
| Database queries | Negligible | Included |
| Cook County | Free | ~100/month |
| Chicago Data Portal | Free | Unlimited |
| **Total Monthly Cost** | **~$200-400** | **50k+ tickets** |

---

## Customer Communication

### How to Describe It
"We automatically look up 15+ data sources on your behalf—everything from Street View imagery to historical weather to your parking history—then compile it into a persuasive defense letter."

### Evidence Categories
1. **Photographic Evidence** - Street View
2. **Data Evidence** - Weather, schedules, permits
3. **GPS Evidence** - Mobile app (app users only)
4. **Case Intelligence** - Officer patterns, win rates
5. **Legal Evidence** - Ordinances, signage requirements

### Win Rate Messaging
- Expired plates: 75% win rate
- City sticker: 70% win rate  
- Expired meter: 67% win rate
- Street cleaning: 45-50% (varies)
- Base default: 30% (no data)

---

## Next Steps / Prioritized Roadmap

### High Priority (Next Quarter)
- [ ] 311 Service Requests integration (sign complaints)
- [ ] IL SOS plate verification
- [ ] Street View timeline (multiple dates)
- [ ] Broken meter reports

### Medium Priority (Next 6 Months)
- [ ] Camera video integration
- [ ] ParkChicago meter payment (complete integration)
- [ ] Municipal court transcripts
- [ ] Traffic camera footage

### Low Priority (Future)
- [ ] Seasonal pattern analysis
- [ ] Officer hearing duration analysis
- [ ] Cross-city comparisons
- [ ] Appeal outcome tracking

---

## File References

**Primary Documents:**
- `COMPREHENSIVE_AUTOMATIC_LOOKUPS.md` - Full details on each source
- `DATA_LOOKUP_SUMMARY.txt` - Executive summary
- `QUICK_LOOKUP_REFERENCE.md` - This file

**Code Files:**
- `lib/street-view-service.ts`
- `lib/weather-service.ts`
- `lib/parking-evidence.ts`
- `lib/unified-parking-checker.ts`
- `lib/contest-intelligence/`
- `pages/api/court-data/win-probability-enhanced.ts`
- `pages/api/contest/generate-letter.ts`

