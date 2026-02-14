# Chicago Meter Time Limits - Quick Reference

## TL;DR

- **Standard limit:** 2 hours (most meters)
- **Extended limit:** 3 hours (~10,000 meters near theaters/entertainment)
- **Rates:** $2.50 (neighborhoods), $4.75 (CBD), $7.00 (Loop)
- **Cannot "feed the meter"** to stay beyond posted time limit
- **No public database** listing which meters have extended limits
- **Check:** ParkChicago Map (map.chicagometers.com) or on-street signs

---

## Time Limits by Type

| Limit | Locations | Estimated Count |
|-------|-----------|-----------------|
| **2 hours** | City-wide default | ~26,000 meters (72%) |
| **3 hours** | Theater districts, entertainment areas, near gyms/schools | ~10,000 meters (28%) |
| **4+ hours** | Rare/unknown | Unknown |

---

## Rates by Zone

| Zone | Rate | Time Limit |
|------|------|------------|
| Loop | $7.00/hr | Usually 2 hrs |
| Central Business District | $4.75/hr | Usually 2 hrs |
| Neighborhoods | $2.50/hr | Usually 2 hrs |

---

## Key Rules

1. **No feeding the meter** - Cannot stay beyond posted time limit even if paid
2. **Time limit ≠ payment** - Must leave when time limit expires, not when payment expires
3. **Check signage** - Posted signs are authoritative
4. **Broken meter** - Still must observe time limit (call 877-242-7901)

---

## Where to Find Time Limits

### Option 1: ParkChicago Map (Best)
- URL: https://map.chicagometers.com/
- Click any meter → shows max time allowed

### Option 2: ParkChicago App
- Enter zone number → tap info icon → shows time limit

### Option 3: On-Street Signs
- Posted at every meter location

### Option 4: City of Chicago
- Phone: 877-242-7901
- Website: chicago.gov/revenue

---

## Hours of Operation

| Zone | Days | Hours | Sunday |
|------|------|-------|--------|
| Loop | Mon-Sun | 24/7 | Paid |
| Central Business District | Mon-Sun | 8am-midnight | Paid |
| Neighborhoods | Mon-Sat | 8am-10pm | FREE* |

*Except "7 Day Paid Parking" signs

---

## Implementation Notes for Ticketless Chicago

### Challenge
**No bulk data source** for time limits by location exists.

### Options
1. **Default to 2 hours** (safe assumption for 72% of meters)
2. **Crowdsource** from users (report time limit when parking)
3. **Scrape ParkChicago Map** (legal review needed)
4. **FOIA request** to City of Chicago for full database
5. **Computer vision** to read signs via camera

### Critical Alert Logic
User parks at 2pm, pays for 3 hours (until 5pm):

**Scenario A: 2-hour meter**
- Alert at 3:45pm: "Time limit expiring in 15 min"
- Alert at 4:00pm: "TIME LIMIT REACHED - Move your car now"
- Note: Payment valid until 5pm but car must move at 4pm

**Scenario B: 3-hour meter**
- Alert at 4:45pm: "Meter + time limit expiring in 15 min"
- Alert at 5:00pm: "Time limit reached"

### User Education Needed
Many users don't know about the "no feeding meter" rule. Must educate that:
- Paying for more time ≠ extended stay
- Time limit is enforced separately from payment
- Moving to different block resets time limit (ZoneHop)

---

## Municipal Code References

- **§ 9-64-190** - No consecutive parking beyond time limit
- **§ 9-64-205** - Meter rates
- **§ 9-64-206** - Hours of operation

---

## Contact Info

- **ParkChicago Support:** 877-242-7901
- **Website:** parkchicago.com
- **Map:** map.chicagometers.com
- **City Revenue:** chicago.gov/revenue

---

**Last Updated:** February 10, 2026
