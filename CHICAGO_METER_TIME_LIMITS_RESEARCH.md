# Chicago Metered Parking Time Limits Research

**Research Date:** February 10, 2026

## Executive Summary

- **Standard time limit:** 2 hours (vast majority of meters)
- **Extended time limits exist:** 3-hour meters at ~10,000 locations (mainly near theaters, entertainment venues)
- **Rates:** $2.50/hour (neighborhoods), $4.75/hour (Central Business District), $7.00/hour (Loop)
- **No comprehensive public list** of which specific locations have extended time limits
- **Time limit is enforced separately from payment** — you cannot "feed the meter" to stay beyond the posted maximum

---

## 1. Standard Time Limits

### 2-Hour Maximum (Default)
Most Chicago metered parking spaces are limited to **2-hour maximum stays**. This applies to the vast majority of the city's approximately 36,000 metered parking spaces.

**Critical Rule:** Even if you pay for additional time on the meter, you **cannot** stay beyond the posted time limit. This is called "feeding the meter" and it's not allowed. If you're in a 2-hour zone, your vehicle must be moved after 2 hours regardless of payment.

**Source:** Chicago Municipal Code § 9-64-190 (Parking meter zones – Regulations)

---

## 2. Extended Time Limit Exceptions

### 3-Hour Meters (~10,000 locations)
Around 2011, the City of Chicago changed approximately **10,000 parking meters from 2-hour to 3-hour time limits** in response to requests from:
- Theater districts
- Entertainment venues
- Movie theaters
- Concert halls
- Areas with gyms and schools

**Background:** The original 2-hour limit made it nearly impossible to park legally while attending a movie or theater performance. Aldermen, community groups, and theater districts advocated for the change.

**Source:** Metropolitan Planning Council - Chicago Parking Meter Analysis

### 4-Hour and 1-Hour Meters
Research did not find evidence of widespread 4-hour or 1-hour metered zones. If they exist, they would be:
- Special exceptions granted by aldermanic request
- Not comprehensively documented in public resources

### How Extended Time Limits Are Granted
Businesses and residents can request changes to time limits through their local aldermanic office or by submitting a Business Feedback Form at:
- cityofchicago.org/revenue → "About Parking Meters" → "Business Feedback Form"

---

## 3. Finding Time Limits by Location

### Official Resources

**1. ParkChicago Map (Recommended)**
- URL: https://map.chicagometers.com/
- Interactive map showing meter locations
- Click on any meter to view:
  - Maximum parking time allowed
  - Hourly rate
  - Hours of operation
  - Zone number

**2. ParkChicago Mobile App**
- Available on iOS and Android
- Enter 6-digit zone number to view:
  - Rates and hours
  - Maximum time limit for that zone
- Allows payment and time extensions (up to the posted maximum)

**3. On-Street Signage**
- Each meter location has posted signs indicating:
  - Maximum time limit (e.g., "2 Hour Maximum")
  - Hours of operation
  - Rate information

### No Comprehensive Public Database
There is **no publicly available comprehensive list** of which specific addresses or blocks have 3-hour vs 2-hour limits. Users must check:
- The ParkChicago Map/app for each location
- Physical signage at the meter
- Contact their alderman's office for their specific area

### Third-Party Dataset (Outdated)
A 2019 GeoJSON dataset exists on GitHub:
- Repository: https://github.com/stevevance/Chicago-Parking-Meters
- File: `chicago_parking_meters_2019-06-26.geojson`
- **Does NOT include time limit data** (only locations, rates, meter IDs)
- Scraped from Chicago Parking Meters, LLC API
- May be outdated (from 2019)

---

## 4. Meter Rates by Zone

### Three-Tier Rate Structure

Chicago divides metered parking into three pricing tiers:

#### Tier 1: Loop (3% of all metered spaces)
- **Rate:** $7.00/hour (8am-9pm), $3.50/hour (9pm-8am)
- **Boundaries:**
  - East: Lake Michigan
  - North: Wacker Drive
  - West: Wacker Drive
  - South: Congress Parkway
- **Enforcement:** 24 hours/day, 7 days/week
- **Time limit:** Typically 2 hours (check specific location)

#### Tier 2: Central Business District (16% of all metered spaces)
- **Rate:** $4.75/hour (8am-midnight)
- **Boundaries:**
  - East: Lake Michigan
  - North: North Avenue
  - West: Halsted Street
  - South: Roosevelt Road
- **Enforcement:** 8am-midnight, Monday-Sunday
- **Time limit:** Typically 2 hours (check specific location)
- **Sub-zone:** West Loop (Grand Ave to I-290, Ashland to Halsted) also $4.75/hour

#### Tier 3: Chicago Neighborhoods (81% of all metered spaces)
- **Rate:** $2.50/hour (8am-10pm)
- **Boundaries:** Everything outside the Central Business District
- **Enforcement:** 8am-10pm, Monday-Saturday
- **Sunday parking:** FREE (except where signs say "7 Day Paid Parking")
- **Time limit:** Typically 2 hours (check specific location)

### Rate Adjustments
- Rates are adjusted annually (each January 1st) based on the Consumer Price Index
- Half-price rates apply during overnight hours in 24-hour zones

---

## 5. Hours of Operation

### General Rules (Non-Loop)
- **Monday-Saturday:** 8:00 AM - 10:00 PM
- **Sunday:** FREE in most neighborhood locations (unless posted "7 Day Paid Parking")
- **Overnight:** FREE (10 PM - 8 AM)

### Loop Exception
- **Enforcement:** 24 hours/day, 7 days/week
- **Overnight rate:** 50% of daytime rate (e.g., $3.50/hour instead of $7.00/hour)

### Central Business District
- **Enforcement:** 8:00 AM - midnight, Monday-Sunday
- Includes areas near Division Street, Halsted Street, North Branch Canal

---

## 6. Important Rules and Restrictions

### No "Feeding the Meter"
**You cannot extend your stay beyond the posted time limit by adding more money.**

Example: If you park at a 2-hour meter at 2:00 PM:
- You must leave by 4:00 PM
- Paying for another hour at 3:30 PM does NOT give you the right to stay until 5:00 PM
- A parking enforcement officer can ticket you for overstaying even if the meter is paid

**Legal basis:** Chicago Municipal Code § 9-64-190 - "No operator of any motor vehicle shall permit such vehicle to remain in the parking meter zone for an additional consecutive time period."

### Broken Meters
If a pay box is broken:
1. Call 877-242-7901 to report it within 24 hours
2. You don't have to pay for parking
3. **BUT** you still must observe the maximum time limit
4. Exceeding the time limit at a broken meter can result in a citation

### ZoneHop (Meter-to-Meter Transfer)
- You CAN move your car and transfer prepaid time to another meter
- Requirements:
  - Same or lower hourly rate
  - Same meter type (on-street to on-street)
  - Cannot transfer between street and parking lot meters
  - Cannot transfer to/from loading zones

### Taxes on Parking
- Daily parking (>$2.00): 23.25% city tax (as of January 1, 2025)
- Plus 6% state and county taxes
- ParkChicago app convenience fee: $0.35 for transactions under 2 hours

---

## 7. Official Information Sources

### City of Chicago
- **Main page:** https://www.chicago.gov/city/en/depts/fin/supp_info/revenue/parking_meters.html
- **FAQs (PDF):** https://www.chicago.gov/content/dam/city/depts/rev/supp_info/ParkingMeter/MeterFAQs.pdf

### Chicago Municipal Code
- **§ 9-64-190:** Parking meter zones – Regulations
  - https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2646267
- **§ 9-64-205:** Parking meter rates
  - https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2646287
- **§ 9-64-206:** Parking meters – Hours of operation
  - https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2646306

### ParkChicago (Official Operator)
- **Website:** https://parkchicago.com/
- **Rates & Hours:** https://parkchicago.com/rates-hours
- **Interactive Map:** https://map.chicagometers.com/
- **Help Desk:** https://chicagometers.zendesk.com/
- **Phone:** 877-242-7901

### Chicago Parking Meters, LLC
Chicago's on-street parking meters are operated by Chicago Parking Meters, LLC under a 75-year concession agreement (started 2009). The city retained authority to change time limits and operational hours through "reserved powers."

---

## 8. Key Findings for Ticketless Chicago App

### Implementation Considerations

1. **Time limit data is NOT available in a bulk dataset**
   - No API or downloadable file with time limits by location
   - Must be scraped from ParkChicago Map or collected manually
   - Consider crowdsourcing or using ParkChicago's map API if available

2. **Default assumption: 2 hours**
   - Safe to assume 2-hour limit unless proven otherwise
   - ~81% of meters are in neighborhoods with 2-hour limits
   - ~10,000 meters (estimated 28%) have 3-hour limits

3. **Time limit enforcement is separate from payment enforcement**
   - Users need alerts for BOTH:
     - Meter expiration (payment running out)
     - Time limit approaching (even if payment is valid)
   - Example: User pays for 3 hours at a 2-hour meter → needs alert at 1:45 to move car

4. **Zone-based lookup**
   - Each meter location has a 6-digit zone number
   - Zone numbers are visible on meter signage and in ParkChicago app
   - Could potentially map zone numbers to time limits through scraping

5. **Signage is authoritative**
   - Physical signs at each location show the actual time limit
   - OCR from user photos could verify time limits
   - Could prompt users to report time limits for database enrichment

### Recommended Data Collection Strategy

**Option A: Manual Database**
- Crowdsource time limits from users
- Start with known theater/entertainment districts (likely 3-hour)
- Default to 2-hour elsewhere
- Allow users to report/correct time limits

**Option B: ParkChicago Map Scraping**
- Scrape https://map.chicagometers.com/ for all meter locations
- Extract time limit data from each meter's info popup
- Refresh quarterly to catch changes
- Legal considerations: check Terms of Service

**Option C: City Data Request**
- Request time limit database from Chicago Parking Meters, LLC
- File Freedom of Information Act (FOIA) request with City of Chicago
- May take weeks/months to fulfill

**Option D: Computer Vision**
- Use phone camera to read meter signage
- OCR to extract time limit from "2 Hour Maximum" text
- Build database incrementally as users park

---

## 9. Related Parking Restrictions

### Time Limits vs Other Restrictions
Time limits are **separate from** other parking restrictions:
- Street cleaning schedules
- Permit zones (residential parking)
- Rush hour tow zones
- Snow emergency routes
- Loading zones
- Bus stops, fire hydrants, etc.

**Rule:** Even if the meter allows 2 hours of parking, other posted signs may prohibit parking entirely during certain times (e.g., "No Parking 4-6 PM Mon-Fri").

### Enforcement Priority
When multiple restrictions apply:
1. **Most restrictive rule wins**
2. No parking/standing/stopping signs override meter time limits
3. Time limits do not relieve drivers from observing other parking regulations

**Source:** Chicago Municipal Code § 9-64-206

---

## 10. Summary Table

| Zone | Rate | Hours | Enforcement | Typical Time Limit | Sunday |
|------|------|-------|-------------|-------------------|---------|
| Loop | $7.00/hr (day)<br>$3.50/hr (night) | 24/7 | 7 days/week | 2 hours | Paid |
| Central Business District | $4.75/hr | 8am-midnight | 7 days/week | 2 hours | Paid |
| West Loop | $4.75/hr | 8am-midnight | 7 days/week | 2 hours | Paid |
| Neighborhoods | $2.50/hr | 8am-10pm | Mon-Sat | 2 hours | FREE* |

*Except where posted "7 Day Paid Parking"

**Extended Time Limits:**
- ~10,000 meters have 3-hour limits (theaters, entertainment, gyms, schools)
- Specific locations not publicly listed
- Check ParkChicago Map or on-street signage

---

## Research Methodology

**Search queries:**
- "Chicago metered parking time limits"
- "Chicago parking meter 2 hour 4 hour exceptions"
- "chicagometers.com time limits by location"
- "Chicago Municipal Code parking meter time limit"
- "concession meters Chicago theater three hour"

**Sources consulted:**
- Chicago Municipal Code (codelibrary.amlegal.com)
- City of Chicago official website
- ParkChicago.com (operator website)
- Metropolitan Planning Council parking meter analysis
- SpotAngels parking guide
- GitHub parking meter datasets
- Third-party parking apps and guides

**Date of research:** February 10, 2026

**Note:** Parking regulations change frequently. Always verify current rules via official city resources or on-street signage.
