# Autopilot America — Complete Defense Checklist

## What We Check For Every Ticket

Every ticket contest letter is built using a multi-layered evidence pipeline that automatically gathers, analyzes, and presents the strongest possible defense. Below is the complete list of everything we check, organized by violation type.

---

## Universal Defense Checks (Applied to ALL Violation Types)

These checks run automatically for every single ticket, regardless of violation type.

### 1. GPS Parking & Departure Proof
- Timestamp and GPS coordinates of when the vehicle parked
- Timestamp and GPS coordinates of when the vehicle departed
- Distance from the parking spot to the ticket location
- Time the vehicle was parked vs. when the ticket was issued
- Whether the vehicle departed before the restriction began
- Departure conclusiveness scoring (how confident the GPS data is)

### 2. Weather Conditions at Time of Violation
- Historical weather data retrieved for the exact date, time, and location
- Temperature, precipitation, wind speed, and visibility conditions
- Snow/ice accumulation that may have obscured signs or markings
- Severe weather that may have created emergency conditions
- Weather relevance is tiered by violation type:
  - **Primary** (directly invalidates ticket): Street Cleaning, Snow Route
  - **Supporting** (contributing factor): Expired Meter, Residential Permit, Fire Hydrant, Bus Stop, Bike Lane
  - **Emergency** (unsafe to comply): Parking in Alley, Handicapped Zone

### 3. FOIA Court Hearing Data (1.18 Million Real Cases)
- Win rate for the specific violation code from actual City of Chicago hearings
- Top dismissal reasons that hearing officers have accepted
- Mail contest vs. in-person contest success rates
- Evidence types that most improved outcomes
- Real case examples matching the user's available evidence
- Argument strategy calibrated to what actually works

### 4. Google Street View Signage Analysis (AI-Powered)
- Multi-angle Street View photographs captured (North, East, South, West views)
- AI analysis of each photograph for:
  - Sign presence, visibility, and legibility
  - Curb markings condition (faded, missing, obscured)
  - Obstructions (trees, construction, other signs blocking view)
  - Sign placement compliance with city spacing requirements
  - Sign content accuracy and consistency
- Physical exhibit photographs included with mailed letters

### 5. Contest Kit (Violation-Specific Strategy)
- Pre-built argument templates based on historical success rates
- Recommended primary argument with win rate data
- Backup argument if primary doesn't fit the facts
- Evidence gap analysis (what evidence we have vs. what would strengthen the case)
- Estimated win probability based on available evidence

### 6. Court Case Matching
- Real cases with similar facts and evidence profiles
- Cases that match the user's specific evidence availability
- Successful contest grounds that apply to the user's situation
- Evidence impact analysis (how much each type of evidence improves win rate)

### 7. Issuing Officer Intelligence
- Officer's historical ticket dismissal rate from hearing records
- Whether the officer's tickets are dismissed more or less often than average
- Strategy calibration based on officer track record
- Argument selection optimized for the specific officer's pattern

### 8. Outcome Learnings Database
- Insights derived from analyzing real contest outcomes
- Pattern recognition across thousands of hearing results
- Win rate impact of specific argument strategies
- Continuously updated as new outcomes are tracked

### 9. Factual Inconsistency Check (Plate/State Mismatch)
- License plate on the violation notice compared to the vehicle owner's actual plate
- Plate state on the violation notice compared to the vehicle's actual registration state
- Under Chicago Municipal Code 9-100-060, factual inconsistencies are an official defense
- A plate or state mismatch means the ticket may have been issued to the wrong vehicle
- This is a **case-dispositive** procedural defense — if present, it leads the letter

### 10. Good-Faith Compliance Notifications
- History of all alerts and reminders sent to the user before the violation occurred:
  - Street cleaning schedule alerts (email, SMS, push notification)
  - Vehicle sticker renewal reminders
  - License plate renewal reminders
  - Emissions test reminders
  - Snow route alerts
  - Tow zone alerts
- Demonstrates the user actively used a compliance tool and attempted to follow the rules
- Shows good-faith effort to obey the law, even if the specific violation occurred
- Delivery confirmation for each notification (sent, delivered timestamps)

### 11. Post-Generation Quality Audit
- AI adversarial review of the generated letter against all available evidence
- Checks for unused evidence, weak arguments, and factual errors
- Quality scoring (letters below threshold are flagged for admin review)
- Automatic correction of common issues
- Ensures every piece of available evidence is properly referenced

---

## Violation-Specific Defense Checks

### Street Cleaning (9-64-010) — $60 Fine
All universal checks plus:
- **Schedule verification**: PostGIS geocoding to determine ward/section, then lookup whether street cleaning was actually scheduled on the ticket date
- **Cleaning occurrence**: Whether the street sweeper actually serviced the specific block (request for GPS logs)
- **Weather cancellation**: Whether bad weather caused cleaning to be cancelled
- **Signage compliance**: Sign spacing, visibility, and placement per city requirements

### Snow Route (9-64-100) — $150 Fine
All universal checks plus:
- **Snowfall threshold**: Whether the 2-inch snowfall threshold was actually met
- **Snow ban activation**: Whether the snow route ban was officially activated
- **Timing**: Whether the vehicle was parked before the ban was declared

### Parking in Alley (9-64-020) — $50 Fine
All universal checks plus:
- **Active loading/unloading**: Whether the vehicle was actively loading or unloading
- **Public vs. private alley**: Whether the alley is actually a public alley
- **Emergency weather**: Whether severe weather created an emergency need to shelter

### Bus Stop (9-64-050) — $100 Fine
All universal checks plus:
- **Signage/markings**: Whether bus stop signs were present and visible
- **Curb markings**: Whether yellow/red curb markings were visible or faded
- **Active bus stop**: Whether the stop is actively serviced by CTA

### Residential Permit Parking (9-64-070) — $65 Fine
All universal checks plus:
- **Permit validity**: Whether the user had a valid residential parking permit
- **Zone verification**: Whether the vehicle was actually in a permit zone
- **Signage**: Whether permit zone signs were properly posted

### Bike Lane (9-64-090) — $150 Fine
All universal checks plus:
- **Lane markings**: Whether bike lane markings were visible or faded
- **Active loading**: Whether the vehicle was actively loading/unloading (allowed briefly)
- **Obstruction**: Whether construction or other conditions obscured the lane markings

### Fire Hydrant (9-64-130) — $150 Fine
All universal checks plus:
- **Distance measurement**: Whether the vehicle was actually within 15 feet of the hydrant
- **Hydrant visibility**: Whether the hydrant was obscured by snow, vegetation, or other objects
- **GPS evidence**: Precise parking location vs. hydrant location

### Expired Meter (9-64-170) — $65 Fine
All universal checks plus:
- **Meter malfunction**: Whether the parking meter was functioning properly
- **Payment evidence**: Whether the user made a payment that wasn't registered
- **Grace period**: Whether the ticket was issued within the grace period

### Handicapped Zone (9-64-180) — $250 Fine
All universal checks plus:
- **Signage/markings**: Whether handicapped zone signs and markings were present and visible
- **Placard validity**: Whether the user has a valid disabled parking placard
- **Emergency conditions**: Whether weather or medical emergency required immediate parking

### No City Sticker (9-64-125 / 9-100-010) — $200 Fine
All universal checks plus:
- **City sticker receipt**: Purchase date, amount, and order ID from forwarded receipt emails
- **Compliance timing**: Whether the sticker was purchased before or after the citation
- **Sticker validity period**: Whether the sticker was valid on the date of the citation
- **Good-faith compliance**: If purchased after citation, demonstrated intent to comply

### Expired Plates / Registration (9-76-160 / 9-80-190) — $100 Fine
All universal checks plus:
- **Registration receipt**: Renewal date, amount, and documentation from IL Secretary of State
- **Compliance timing**: Whether registration was renewed before or after the citation
- **Grace period**: Illinois law provides a grace period for displaying updated stickers
- **Good-faith compliance**: If renewed after citation, demonstrated intent to comply

---

## Red Light Camera Specific Checks (8 Automated Analyses)

Red light camera violations receive all universal checks PLUS eight specialized physics-based and procedural analyses:

### 1. Yellow Light Timing Analysis
- Posted speed at the intersection
- Chicago's actual yellow light duration at that intersection
- ITE/MUTCD nationally recommended yellow duration for that speed
- Whether Chicago's yellow is shorter than the national standard
- Specific shortfall in seconds
- References the 2014 Chicago Inspector General investigation

### 2. Right-Turn-on-Red Detection
- GPS heading change analysis to detect right turns
- Whether the vehicle came to a complete stop before turning
- Minimum speed recorded before the turn
- Whether the turn qualifies as a legal right-on-red under 625 ILCS 5/11-306(c)

### 3. Intersection Geometry Analysis
- Approach distance from first GPS reading to the camera
- Closest point of approach to the camera
- Average approach speed through the intersection
- Trajectory analysis

### 4. Weather at Violation Time
- Exact weather conditions at the specific intersection at the time of violation
- Temperature, precipitation, visibility, and road conditions
- Sun position (glare analysis)
- How weather affected stopping distance and signal perception

### 5. Violation Spike Detection (Camera Malfunction Indicator)
- Number of violations issued at this camera on the violation date
- 30-day average daily violations for this camera
- Spike ratio (if violations that day were 3x+ the average)
- Indicates possible camera malfunction or miscalibration

### 6. Dilemma Zone Analysis (Physics-Based)
- Stopping distance required at the driver's actual speed
- Distance to the stop bar at the moment of decision
- Distance required to fully clear the intersection
- Whether the driver could safely stop OR safely clear (if neither, the driver was in the "dilemma zone")
- Based on standard deceleration rate (10 ft/s²)
- Recognized traffic engineering concept (ITE/FHWA)

### 7. Late Notice Defense (Procedural)
- Days between the violation date and the notice mailing date
- Whether the notice exceeded the 90-day statutory limit under 625 ILCS 5/11-208.6
- This is a **case-dispositive** procedural defense — if late, the ticket must be dismissed regardless of the underlying facts

### 8. Full GPS Sensor Data Exhibit
- Complete speed-vs-time profile chart
- GPS trace with all speed readings during approach
- Accelerometer braking analysis (peak deceleration in G-forces)
- SHA-256 cryptographic hash for data integrity verification
- All data captured automatically by the device's hardware sensors

---

## Speed Camera Specific Checks

Speed camera violations receive all universal checks plus:
- **GPS speed data**: User's app-recorded GPS speed at the camera location
- **Posted speed limit**: Cross-referenced with the camera's posted limit
- **Speed comparison**: GPS speed vs. citation speed

---

## Evidence Sources Summary

| Evidence Source | Data Points | Applied To |
|---|---|---|
| GPS Parking/Departure | Timestamps, coordinates, distance, duration | All violations |
| Weather Data | Temperature, precipitation, visibility, wind, road conditions | All violations (tiered relevance) |
| FOIA Court Data | 1.18M hearing outcomes, dismissal reasons, win rates | All violations |
| Google Street View | Multi-angle photos + AI signage analysis | All violations |
| Contest Kits | Proven argument templates, win rates | All violations |
| Court Case Matching | Similar cases with matching evidence profiles | All violations |
| Officer Intelligence | Dismissal rate, tendency, strategy guidance | All violations |
| Outcome Learnings | Pattern recognition from real outcomes | All violations |
| Factual Inconsistency | Plate/state mismatch on violation notice | All violations |
| Notification History | All alerts/reminders sent before violation | All violations |
| Quality Audit | AI review, unused evidence detection | All violations |
| City Sticker Receipt | Purchase date, amount, validity | City sticker violations |
| Registration Receipt | Renewal date, amount, grace period | Registration/plate violations |
| Street Cleaning Schedule | Ward/section lookup, schedule verification | Street cleaning violations |
| Red Light Sensor Data | Speed profile, GPS trace, accelerometer, cryptographic hash | Red light violations |
| Yellow Light Timing | ITE standard vs. Chicago actual, shortfall analysis | Red light violations |
| Right-Turn Detection | Heading change, stop detection, legal qualification | Red light violations |
| Intersection Geometry | Approach distance, closest point, trajectory | Red light violations |
| Violation Spike | Daily count vs. average, camera malfunction indicator | Red light violations |
| Dilemma Zone Physics | Stopping distance vs. clearance distance | Red light violations |
| Late Notice Check | Days to notice, 90-day statutory limit | Red light violations |
| Speed Camera GPS | App-recorded speed vs. citation speed | Speed camera violations |

---

## How the Letter Is Built

1. **All evidence is gathered in parallel** — GPS data, weather, FOIA stats, Street View, receipts, court cases, and officer intelligence are all fetched simultaneously for speed.

2. **Contest kit selects the strongest argument** — Based on the violation type and available evidence, the system picks the argument with the highest historical success rate.

3. **AI generates a professional legal letter** — Using Claude AI with all gathered evidence, proven argument templates, and real case outcomes to write a formal contest letter.

4. **Post-generation quality audit** — An adversarial AI review checks the letter against all available evidence to ensure nothing was missed and no factual errors exist.

5. **Physical exhibits are attached** — Street View photographs, sensor data charts, receipts, and any user-uploaded evidence are included as physical attachments with the mailed letter.

6. **Letter is mailed via USPS Certified Mail** — Professional formatting, proper legal formatting, and delivery tracking.

---

*This document reflects the complete defense pipeline as of March 2026. The system continuously improves as new court outcomes are analyzed and new defense strategies are identified.*
