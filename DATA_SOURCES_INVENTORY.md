# COMPREHENSIVE DATA INVENTORY FOR PARKING TICKET CONTESTATION
## All Data Sources Potentially Useful for Contest Letters

Generated: 2026-02-12

---

## SECTION 1: EMAIL & RECEIPT FORWARDING SYSTEM

### 1.1 City Sticker Purchase Receipts
**Table:** `city_sticker_receipts`
**Location:** Supabase public schema
**Migration:** `/supabase/migrations/20260207113000_create_city_sticker_receipts.sql`

**Fields Available:**
- `id` (UUID)
- `user_id` (references auth.users)
- `sender_email` - Email address that sent the receipt (e.g., sebis-noreply@chicago.gov)
- `email_subject` - Original email subject line
- `storage_path` - S3 bucket path where receipt stored
- `file_name` - Filename of stored document
- `forwarded_at` (timestamp) - When email was forwarded
- `created_at` (timestamp)

**Current Usage in Contest Letters:** YES - Used in city sticker contest kit to prove payment/ownership
**Data Type:** Email forwarding capture
**Status:** ACTIVE - Users forward bills to unique address
**Search Pattern:** `sticker|city_sticker|receipt`

---

### 1.2 Registration Evidence (License Plate Stickers & City Stickers)
**Table:** `registration_evidence_receipts`
**Location:** Supabase public schema
**Migration:** `/supabase/migrations/20260207155000_create_registration_evidence_receipts.sql`

**Fields Available:**
- `id` (UUID)
- `user_id`
- `source_type` (ENUM: 'city_sticker' | 'license_plate')
- `sender_email` - Original email sender
- `email_subject` - Subject line
- `email_text` - Plain text version of email
- `email_html` - HTML version of email
- `storage_bucket` - S3 bucket name
- `storage_path` - S3 path
- `screenshot_path` - Parsed screenshot path
- `file_name` - Original filename
- `forwarded_at` (timestamp)
- `parsed_purchase_date` (DATE) - OCR-extracted purchase date
- `parsed_order_id` (TEXT) - OCR-extracted order ID
- `parsed_amount_cents` (INTEGER) - OCR-extracted purchase amount
- `created_at` (timestamp)

**Current Usage in Contest Letters:** YES - Dual purpose for city sticker AND license plate registration evidence
**Data Type:** Email capture + OCR extraction
**Status:** ACTIVE
**Evidence Value:** HIGH - Proves vehicle registration/ownership at time of ticket

---

### 1.3 Red Light Camera Receipts (Speed & Red Light Violation Timeline)
**Table:** `red_light_receipts`
**Location:** Supabase public schema
**Migration:** `/supabase/migrations/20260207154500_create_red_light_receipts.sql`

**Fields Available:**
- `id` (UUID)
- `user_id`
- `device_timestamp` (timestamptz) - When pass occurred on user's device
- `server_received_at` (timestamptz) - Server receipt time
- `camera_address` - Street address of camera
- `camera_latitude`, `camera_longitude` - GPS coordinates
- `intersection_id` - Unique intersection identifier
- `heading` (degrees) - Vehicle heading direction
- `approach_speed_mph` - Speed approaching intersection
- `min_speed_mph` - Minimum speed recorded during pass
- `speed_delta_mph` - Difference from speed limit
- `full_stop_detected` (BOOLEAN) - Whether vehicle fully stopped
- `full_stop_duration_sec` - How long stop held
- `horizontal_accuracy_meters` - GPS accuracy
- `estimated_speed_accuracy_mph` - Speed measurement accuracy
- `trace` (JSONB) - Full speed/position trace data for technical analysis
- `created_at` (timestamp)

**Current Usage in Contest Letters:** PARTIAL - Used for camera avoidance evidence, needs expansion
**Data Type:** Mobile app telemetry capture (CoreLocation + motion data)
**Status:** ACTIVE
**Evidence Value:** VERY HIGH - Proves speed/stopping behavior at time of alleged violation
**Unused Potential:** Can prove user DIDNT run red light (full_stop_detected) or was below speed limit

---

## SECTION 2: PARKING DETECTION & LOCATION DATA

### 2.1 Parking History (Mobile App Detection)
**Table:** `user_parking_history` (inferred from mobile code)
**Location:** Supabase public schema
**Stored:** `src/services/BackgroundTaskService.ts`, `src/services/ParkingDetectionStateMachine.ts`

**Fields Available (from code inspection):**
- `parked_at` (ISO timestamp) - When Bluetooth disconnect + CoreMotion detected stationary
- `departed_at` (ISO timestamp) - When CoreMotion detected automotive + GPS confirmed movement
- `parking_location_latitude` / `parking_location_longitude` - GPS coordinates
- `address` (STRING) - Reverse geocoded address
- `duration_minutes` - How long parked (departed_at - parked_at)
- `departure_distance_meters` - How far user moved to confirm departure
- `restriction_detected` - What parking restrictions were detected at location
- `street_cleaning_date` - If on street cleaning route
- `snow_route` - If on snow route
- `permit_zone` - If in permit zone

**Current Usage in Contest Letters:** YES - Core evidence for departure proof
**Data Type:** Mobile sensor fusion (Bluetooth Classic + CoreLocation + CoreMotion on iOS; Bluetooth + LocationManager on Android)
**Status:** ACTIVE
**Evidence Value:** CRITICAL - GPS-verified proof user left location before/after ticket time
**Location in Code:** 
  - iOS: `BackgroundLocationModule.swift` (CLLocationManager + CMMotionActivityManager)
  - Android: `BluetoothMonitorService.kt` + `ParkingDetectionStateMachine.ts`

---

### 2.2 Saved Parked Locations (User Pinned Locations)
**Table:** `saved_locations` (inferred)
**Location:** AsyncStorage (mobile) + Supabase sync

**Fields:**
- Location name (e.g., "My Apartment", "Work")
- Latitude/longitude
- Address
- Typical parking time window
- Frequency of parking there

**Current Usage:** Supplementary - Shows user familiarity with location (residential permit evidence)
**Evidence Value:** MEDIUM - Can prove regular visitor pattern for residential permit violations

---

### 2.3 Camera Pass History (Speed & Red Light Camera Detection)
**Table:** `camera_pass_history`
**Location:** Supabase public schema
**Migration:** `/supabase/migrations/20260206170000_create_camera_pass_history.sql`

**Fields Available:**
- `id` (UUID)
- `user_id`
- `passed_at` (timestamptz) - When user passed camera
- `camera_type` (ENUM: 'speed' | 'redlight')
- `camera_address` - Location name
- `camera_latitude`, `camera_longitude` - Exact coordinates
- `user_latitude`, `user_longitude` - Where user was when passing
- `user_speed_mps`, `user_speed_mph` - Measured speed in both units
- `expected_speed_mph` - Posted speed limit (if available)
- `speed_delta_mph` - Difference (user_speed - expected_speed)
- `created_at` (timestamp)

**Current Usage in Contest Letters:** MINIMAL - Rarely referenced despite being highly relevant
**Data Type:** Mobile app telemetry collected as user drives
**Status:** ACTIVE
**Evidence Value:** VERY HIGH - Can provide timeline of user location at specific timestamps
**Unused Potential:** 
  - Proves user was NOT at ticket location at ticket time (camera data shows user elsewhere)
  - Shows consistent driving patterns (travel time analysis)
  - Speed delta can prove compliance with posted limits

---

## SECTION 3: WEATHER & ENVIRONMENTAL DATA

### 3.1 Historical Weather Data
**Service:** `lib/weather-service.ts`
**Data Source:** National Weather Service API (FREE, no key needed) + OpenWeatherMap (REQUIRES API KEY)

**Data Available:**
- Temperature (°F)
- Precipitation type & amount (rain, snow, sleet)
- Snow accumulation (inches)
- Wind speed & direction
- Visibility (miles)
- Relative humidity
- Weather condition text (clear, cloudy, rainy, snowing, etc.)
- Timestamps for forecast periods

**Historical Data Accessible:**
- Past 7-30 days via NWS
- Organized by date/time
- Specific to Chicago

**Current Usage in Contest Letters:** YES - Weather.ts integrated into generate-letter.ts
**Evidence Value:** CRITICAL - Weather cancels street cleaning, proves snow route conditions
**Contest Applications:**
- Street Cleaning (9-64-010): "No cleaning on snow/rain days" - if weather occurred, ticket invalid
- Snow Route (9-64-100): Requires 2" snowfall threshold - weather data proves threshold not met
- Expired Meter (9-64-170): User can argue unable to return in storm conditions
- Bike Lane (9-64-090): Markings obscured by snow/ice

**Current Integration:** PARTIAL
- Weather fetched in generate-letter.ts
- Only injected for weather-relevant violations
- Could be expanded to more violation types

**Code Location:** 
- `lib/weather-service.ts` - Fetches NWS API
- `pages/api/contest/generate-letter.ts` - Uses weather in letter generation
- `WEATHER_RELEVANCE` mapping shows which violations get weather

---

### 3.2 Street Cleaning Schedule
**Table:** `street_cleaning_schedule`
**Location:** Supabase public schema
**Data Ingestion:** `scripts/execute-meter-inserts.ts`

**Fields Available:**
- Date of street cleaning
- Ward number
- Side of street (odd/even or compass direction)
- Restriction hours (e.g., "7AM-9AM" or "9AM-4PM")
- Street name
- Geospatial data (PostGIS geometry)

**Current Usage in Contest Letters:** YES - Used to determine if street was actually cleaning that day
**Evidence Value:** CRITICAL - Proves user parked on non-cleaning day OR cleaning was cancelled due to weather
**Used In:** Street Cleaning defense kit

---

### 3.3 Snow Routes & Winter Restrictions
**Tables:** `snow_routes`, `snow_route_status`, `snow_events`, `storm_events`
**Location:** Supabase public schema

**Data Available:**
- Snow route names & geometry (which blocks are snow routes)
- Snow emergency declaration dates/times
- Thresholds triggered (2" accumulation, etc.)
- When restrictions started/ended
- Historical snow events with accumulation data

**Current Usage in Contest Letters:** YES - Snow route defense kit
**Evidence Value:** CRITICAL - Proves threshold not met or user had warning time

---

## SECTION 4: COURT & HEARING OFFICER INTELLIGENCE

### 4.1 Contest Intelligence System (AI-Powered Analysis)
**Tables:**
- `ward_contest_intelligence` - Ward-specific win rates by violation type
- `hearing_officer_patterns` - Individual hearing officer tendencies
- `signage_reports` - Physical sign conditions reported by users
- `letter_quality_scoring` - Scoring of successful vs failed letters
- `court_case_outcomes` - Historical outcomes from city portal

**Migration:** `/supabase/migrations/20250121_contest_intelligence_system.sql`

**Ward Intelligence Fields:**
- `ward` (INTEGER) - Chicago ward number
- `total_contests`, `total_wins`, `total_losses`
- `overall_win_rate` (DECIMAL)
- `violation_stats` (JSONB) - Win rate by violation code
- `defense_stats` (JSONB) - Win rate by defense type (signage, weather, etc.)
- `top_arguments` (JSONB) - Ranked arguments by success rate
- `seasonal_patterns` (JSONB) - Win rates by season
- `avg_days_to_decision`, `avg_fine_amount`
- `enforcement_score` - Tickets per capita

**Hearing Officer Patterns Fields:**
- `officer_id`, `officer_name`
- `total_cases`, `total_dismissals`, `overall_dismissal_rate`
- `violation_patterns` (JSONB) - By violation type
- `defense_acceptance` (JSONB) - What arguments work with this officer
- `evidence_preferences` (JSONB) - Photo/receipt/witness weights
- `tends_toward` (ENUM: lenient | strict | neutral)
- `strictness_score` (0-1)
- `prefers_detailed_evidence` (BOOLEAN)
- `pattern_notes` (TEXT[])

**Current Usage in Contest Letters:** ACTIVE - Used in `contest-intelligence/` modules
**Evidence Value:** STRATEGIC - Shapes letter tone and argument selection
**Location in Code:**
- `lib/contest-intelligence/hearing-officers.ts` - Officer lookup
- `lib/contest-intelligence/ward-intelligence.ts` - Ward analysis
- `lib/contest-intelligence/letter-scoring.ts` - Quality scoring

---

### 4.2 Signage Database (User Reports)
**Table:** `signage_reports`
**Location:** Supabase public schema

**Fields:**
- Location (lat/lon, address, ward)
- `sign_type` (ENUM: street_cleaning, no_parking, permit_zone, loading_zone, etc.)
- `sign_text` - Actual text on the sign
- `restriction_hours` - Times when restriction applies
- `condition` (ENUM: good | faded | damaged | obscured | missing)
- `obstruction_type` (tree, graffiti, snow, etc.)
- `photo_urls` - User-provided photos
- `verified` (BOOLEAN) - Admin verification status
- `used_in_contests` (INTEGER) - How many contests used this sign
- `contest_win_rate` (DECIMAL) - Win rate when sign was referenced
- `street_view_url` - Google Street View link
- `street_view_date` - When photo was taken

**Current Usage in Contest Letters:** YES - Signage is top defense for many violations
**Evidence Value:** CRITICAL - Proves sign missing, faded, obscured, or illegible
**Unused Potential:** Community-sourced signage data not fully leveraged yet

---

### 4.3 Court Case Outcomes
**Table:** `court_case_outcomes` (inferred)
**Location:** Referenced in generate-letter.ts

**Data Available:**
- `violation_code` - 9-64-XXX code
- `outcome` (ENUM: dismissed | reduced | upheld)
- Court location
- Judge/officer name
- Defense arguments presented
- Evidence presented
- Similar case pattern data

**Current Usage:** YES - Historical data lookup in letter generation
**Evidence Value:** STRATEGIC - Identifies what arguments work in similar cases

---

### 4.4 FOIA Requests & Portal Data
**Table:** `ticket_foia_requests`
**Location:** Supabase public schema
**Migration:** `/supabase/migrations/20260210143000_create_ticket_foia_requests.sql`

**Fields:**
- `id` (UUID)
- `ticket_id` (references detected_tickets)
- `contest_letter_id` (references contest_letters)
- `user_id`
- `request_type` (e.g., 'ticket_evidence_packet')
- `status` (ENUM: queued | drafting | sent | fulfilled | failed | not_needed)
- `source` - Where FOIA was initiated from
- `notes` - Admin notes
- `request_payload` (JSONB) - What was requested
- `response_payload` (JSONB) - What was received from city
- `requested_at`, `sent_at`, `fulfilled_at` (timestamps)

**Current Usage:** EMERGING - Infrastructure ready, process being built
**Evidence Value:** CRITICAL - FOIA requests can obtain:
  - Original ticket issuance details from city system
  - Officer notes/observations
  - Photos city took
  - Violation evidence city relied on
  - Officer training/qualifications
  - Camera calibration records

---

## SECTION 5: USER VEHICLE & REGISTRATION DATA

### 5.1 User Profiles (Vehicle Info)
**Table:** `user_profiles`
**Location:** Supabase public schema

**Fields Available (from database.types):**
- `id` (UUID)
- `user_id` (references auth.users)
- `license_plate` - Vehicle plate number
- `license_plate_state` - Registration state
- `vehicle_make`, `vehicle_model`, `vehicle_year`
- `vehicle_color`
- `vehicle_vin` (partial, if provided)
- `license_type` (personal | commercial | leased)
- `address` (registered address for residency proof)
- `address_verification_status`
- `email`, `phone`
- Various permit/registration tracking fields

**Current Usage in Contest Letters:** YES - Basic vehicle identity
**Evidence Value:** MEDIUM - Used in letters to confirm correct vehicle cited
**Location in Code:**
- Used in `lib/database.types.ts` for all user queries
- Referenced in profile pages and contest letter generation

---

### 5.2 User Addresses (Residency History)
**Table:** `user_addresses`
**Location:** Supabase public schema

**Fields:**
- `id` (UUID)
- `user_id`
- `address` (full address)
- `city`, `state`, `zip`
- `address_type` (ENUM: residence | work | other)
- `is_primary` (BOOLEAN) - Current residence
- `verified` (BOOLEAN) - Admin verified
- `verified_source` - Utility bill, DMV, lease, etc.
- `verified_date`
- `created_at`, `updated_at`

**Current Usage:** YES - Residential permit verification
**Evidence Value:** MEDIUM - Proves residency for residential permit violations
**Location in Code:** Used in permit zone document verification

---

## SECTION 6: EVIDENCE & DOCUMENT UPLOADS

### 6.1 User-Uploaded Evidence (Generic)
**Bucket:** `ticket_photos` / `evidence_uploads`
**Service:** Supabase Storage

**Evidence Types Stored:**
- Photos of violations (sign condition, parking spot, ticket itself)
- Video evidence (dash cam recordings)
- Receipts (parking meter, payment app screenshots)
- Documents (lease, utility bills, registration)
- Custom evidence

**Current Usage:** YES - Core to contest letter evidence
**Evidence Value:** CRITICAL - User-provided visual proof
**Processing:** 
- Analyzed by OCR in `lib/contest-intelligence/evidence-analysis.ts`
- Extracted data (dates, amounts, numbers) added to letter

---

### 6.2 Residency Proof Documents
**Tables:** Implied by storage + metadata
**Bucket:** `residency_proofs` (inferred)

**Document Types:**
- Utility bills (ComEd, Peoples Gas, water)
- Lease agreements
- Mortgage statements
- Property tax records
- Voter registration

**Current Usage:** YES - Residential permit and city sticker proofs
**Evidence Value:** CRITICAL - Required for multiple defenses

---

### 6.3 Vehicle Registration Documents
**Tables:** Implied storage
**Bucket:** `registration_documents` / `license_images`

**Document Types:**
- Driver's license (front/back)
- Vehicle registration card
- Proof of insurance
- Title/ownership documents

**Current Usage:** YES - City sticker and permit zone processes
**Evidence Value:** MEDIUM - Proof of ownership

---

## SECTION 7: TICKET & CONTEST TRACKING

### 7.1 Detected Tickets
**Table:** `detected_tickets` (inferred)
**Location:** Supabase public schema

**Core Fields:**
- `id` (UUID)
- `user_id`
- `license_plate` - Plate cited
- `violation_code` - 9-64-XXX code
- `violation_description` - Human-readable
- `ticket_number` - City's citation number
- `ticket_date` - Date of alleged violation
- `ticket_time` - Time of alleged violation (if available)
- `ticket_location` - Where ticket was issued
- `ticket_location_latitude`, `ticket_location_longitude`
- `fine_amount`
- `due_date`
- `paid` (BOOLEAN)
- `paid_date`
- `photo_urls` - Photos city took (if captured)
- `additional_evidence` (JSONB) - City's notes/evidence
- `created_at` (timestamp when detected)

**Current Usage:** YES - Core record
**Evidence Value:** CRITICAL - Foundation for all contests

---

### 7.2 Ticket Contests
**Table:** `ticket_contests`
**Location:** Supabase public schema

**Fields:**
- `id` (UUID)
- `ticket_id` (references detected_tickets)
- `user_id`
- `contest_status` (ENUM: drafted | submitted | hearing_scheduled | dismissed | upheld | appealed)
- `hearing_date` - When hearing is/was scheduled
- `hearing_officer_id` - Who heard the case
- `outcome` (ENUM: dismissed | reduced | upheld | withdrawn)
- `outcome_details` (JSONB) - Reason for outcome
- `grounds_asserted` - What defense was used
- `evidence_presented` - What evidence user submitted
- `city_evidence` - What city submitted
- `decision_notes` - Officer's notes
- `decision_date`
- `fine_reduction_amount` (if reduced)
- `appeal_filed` (BOOLEAN)
- `appeal_date`
- `created_at`, `updated_at`

**Current Usage:** YES - Tracks contest lifecycle
**Evidence Value:** CRITICAL - Historical outcome data

---

### 7.3 Contest Letters
**Table:** `contest_letters` (inferred)
**Location:** Supabase public schema

**Fields:**
- `id` (UUID)
- `contest_id` (references ticket_contests)
- `ticket_id` (references detected_tickets)
- `user_id`
- `generated_by` (ENUM: user | autopilot | attorney)
- `letter_content` (TEXT) - Full letter body
- `letter_pdf_url` (S3 path)
- `argument_summary` - What arguments were used
- `evidence_cited` (JSONB) - What evidence was referenced
- `quality_score` (DECIMAL 0-1) - How well-written
- `predicted_win_probability` (DECIMAL 0-1)
- `created_at`
- `mailed_at` (when physically mailed)
- `outcome_id` (references contest/outcome if known)

**Current Usage:** YES - Letter generation and tracking
**Evidence Value:** CRITICAL - Basis for all contests

---

## SECTION 8: FINANCIAL & UTILITY DATA

### 8.1 Utility Bill Forwarding (Residency Proof)
**Extracted From:** Email forwarding service (`pages/api/email/forward.ts`)
**Processing:** `pages/api/webhooks/evidence-email.ts`

**Data Extracted via OCR:**
- Account holder name
- Service address (proves residency)
- Account number
- Service period (billing dates)
- Utility type (electric, gas, water)
- Amount due
- Account status

**Storage:** `registration_evidence_receipts` table with OCR fields

**Current Usage:** YES - Residential permit and city sticker proof
**Evidence Value:** CRITICAL - Proves address at time of violation

**Utilities Supported:**
- ComEd (electric)
- Peoples Gas (natural gas)
- Chicago Water Department (water)
- Others via auto-forwarding

---

### 8.2 Property Tax Records
**Service:** Cook County API integration (`lib/cook-county-api.ts`)
**Data Source:** Cook County Assessor

**Data Available:**
- Parcel number
- Property address
- Owner name(s)
- Assessed value
- Tax amount
- Tax status (paid/delinquent)

**Current Usage:** Property tax appeals (out of scope for parking tickets)
**Potential For Parking:** None - property tax is separate system

---

## SECTION 9: SIGNAGE & STREET DATA

### 9.1 Permit Zone Geometries
**Table:** `parking_permit_zones`
**Location:** Supabase with PostGIS spatial data

**Fields:**
- Zone ID (e.g., "Ward 3 Zone A")
- `geometry` (PostGIS polygon) - Exact boundaries
- Resident permit requirements
- Visitor permit requirements
- Non-resident parking rules
- Restriction hours
- Ward number
- Associated streets

**Current Usage:** YES - Permit zone violation analysis
**Evidence Value:** MEDIUM - Used to verify if location is actually in zone

---

### 9.2 Snow Routes (Spatial Data)
**Table:** `snow_routes`
**Location:** Supabase with PostGIS

**Fields:**
- Route name/number
- `geometry` (PostGIS linestring) - Which blocks
- Restriction hours
- Snow emergency rules
- Threshold for activation

**Current Usage:** YES - Snow route defense
**Evidence Value:** MEDIUM - Confirms if street is actually on route

---

## SECTION 10: MESSAGING & NOTIFICATION LOGS

### 10.1 Email Logs
**Table:** `email_logs`
**Location:** Supabase public schema

**Fields:**
- `id` (UUID)
- `user_id`
- `email_address` - Recipient
- `email_type` (ENUM: reminder | alert | confirmation | etc.)
- `template_name` - Which template was used
- `subject`
- `body`
- `sent_at` (timestamp)
- `opened_at` - If tracked
- `bounced` (BOOLEAN)
- `delivery_status`

**Current Usage:** YES - User communication tracking
**Evidence Value:** LOW - Not directly useful for contests
**Relevance:** Records that user received automated reminders about violation

---

### 10.2 SMS Logs
**Table:** `sms_logs` / `incoming_sms`
**Location:** Supabase public schema

**Fields:**
- `id` (UUID)
- `user_id`
- `phone_number` - Recipient
- `message_type`
- `body` - Message content
- `sent_at`, `delivered_at` (timestamps)
- `status` (sent | delivered | failed)
- For incoming: `from_number`, `received_body`, `received_at`

**Current Usage:** Operational - Alert delivery tracking
**Evidence Value:** LOW - Not used in contests
**Potential:** Could prove user received warning/reminder

---

## SECTION 11: HISTORICAL / BACKGROUND DATA

### 11.1 Street Cleaning Schedule (Chicago City Data)
**Data Source:** Chicago open data portal
**Table:** `street_cleaning_schedule`

**Coverage:** Complete historical street cleaning schedule
**Data Includes:**
- Daily cleaning schedule by block
- Holidays when cleaning is cancelled
- Weather exceptions (no cleaning on snow/rain days)
- Both sides of each street

**Current Usage:** YES - Used in street cleaning defense
**Evidence Value:** CRITICAL - Determines if cleaning actually happened that day

---

### 11.2 Towed Vehicles
**Table:** `towed_vehicles`
**Location:** Supabase public schema

**Fields:**
- `id` (UUID)
- `license_plate`
- `vehicle_make`, `model`, `year`, `color`
- `plate_state`
- `impound_address` - Where towed to
- `tow_date` - When towed
- `tow_reason` - Why (e.g., "street cleaning", "snow emergency")
- `tow_cost`
- `release_date`
- `released_to` - Who picked it up
- `release_cost`

**Current Usage:** Alert system (not contests)
**Evidence Value:** LOW - Shows enforcement patterns
**Potential:** Proves user wasn't parked illegally (if vehicle was towed elsewhere)

---

### 11.3 Ward Intelligence
**Covered Above** - See Section 4.1 (Ward Contest Intelligence)

---

## SECTION 12: AUTOPILOT & AUTOMATION DATA

### 12.1 Portal Scraper Results
**Service:** `lib/chicago-portal-scraper.ts`
**Data Source:** City of Chicago payment portal

**Data Captured:**
- List of all tickets issued to a plate
- Ticket numbers
- Fine amounts
- Violation descriptions
- Due dates
- Payment status
- Officer/location information

**Current Usage:** YES - Autopilot system uses to identify tickets
**Evidence Value:** MEDIUM - Confirms ticket details match city records

---

### 12.2 Autopilot Letter Generation Queue
**Tables:** Implied by `pages/api/cron/autopilot-generate-letters.ts`

**Process:**
1. Cron fetches all monitored plates from user list
2. Runs portal scraper on each plate
3. Finds new tickets not yet imported
4. Checks if ticket is contestable (within deadline)
5. Generates contest letters automatically
6. Queue letters for mailing

**Data Used:** All of the above sources

---

## SUMMARY TABLE: DATA SOURCES BY CONTEST USEFULNESS

| Data Source | Current Use | Evidence Value | Expansion Potential | Priority |
|---|---|---|---|---|
| **Parking History** | Core | CRITICAL | Medium | 1 - ACTIVE |
| **Weather Data** | Integrated | CRITICAL | Medium | 2 - ACTIVE |
| **Camera Pass History** | Minimal | VERY HIGH | HIGH | 3 - EXPAND |
| **Red Light Receipts** | Partial | VERY HIGH | MEDIUM | 4 - EXPAND |
| **City Sticker Receipts** | YES | CRITICAL | Low | 5 - ACTIVE |
| **Registration Evidence** | YES | CRITICAL | Medium | 6 - ACTIVE |
| **Ward Intelligence** | Strategic | HIGH | Low | 7 - ACTIVE |
| **Hearing Officer Patterns** | Strategic | HIGH | Low | 8 - ACTIVE |
| **Signage Reports** | Integrated | CRITICAL | HIGH | 9 - GROW |
| **Street Cleaning Schedule** | YES | CRITICAL | Low | 10 - ACTIVE |
| **Court Case Outcomes** | Yes | STRATEGIC | Medium | 11 - ACTIVE |
| **Utility Bills** | YES | CRITICAL | Low | 12 - ACTIVE |
| **User Addresses** | YES | MEDIUM | Low | 13 - ACTIVE |
| **Permit Zones** | YES | MEDIUM | Low | 14 - ACTIVE |
| **FOIA Requests** | EMERGING | CRITICAL | VERY HIGH | 15 - NEW |
| **Towed Vehicles** | Alert only | LOW | HIGH | 16 - FUTURE |
| **Email Logs** | Operational | LOW | Low | 17 - ARCHIVE |
| **SMS Logs** | Operational | LOW | Low | 18 - ARCHIVE |

---

## KEY FINDINGS

### Currently Underutilized Data Sources

1. **Camera Pass History (MEDIUM PRIORITY)**
   - Contains exact location/time stamps
   - Could prove user was elsewhere during ticket time
   - Rarely referenced in current letters
   - **Action:** Add automatic timeline conflict detection

2. **Red Light Receipts Trace Data (HIGH PRIORITY)**
   - `trace` JSONB field contains full speed/GPS trace
   - Shows second-by-second movement
   - Can prove full stop or below-limit speed
   - **Action:** Parse trace data and auto-generate technical defense

3. **Signage Reports (MEDIUM PRIORITY)**
   - Growing community database of sign conditions
   - High win rate when sign is referenced
   - Under-leveraged in letter generation
   - **Action:** Geospatial query to find reported signs near ticket location

4. **FOIA Request Infrastructure (CRITICAL PRIORITY)**
   - Table structure exists and ready
   - No active FOIA requests being generated
   - Could get city's evidence/notes/photos
   - **Action:** Implement automated FOIA request generation post-contest

5. **Towed Vehicles Data (FUTURE)**
   - Currently alert-only
   - Could be used to prove enforcement patterns
   - Could help with selective enforcement arguments
   - **Action:** Link to ward/location statistics

---

## RECOMMENDATIONS FOR CONTEST LETTER ENHANCEMENT

### Immediate (Next 2 weeks)
1. Add camera pass history timeline to letters
2. Expand weather data usage to all weather-affected violations
3. Auto-parse signage database for relevant signs near ticket location

### Short Term (Next month)
1. Implement red light receipts trace parsing for speed defense
2. Add FOIA request generation to autopilot system
3. Implement tow data correlation for enforcement pattern arguments

### Medium Term (2-3 months)
1. Build ward-specific argument optimization
2. Expand signage community reports
3. Create user-facing evidence collection guidance based on location/violation type

### Long Term
1. ML-based evidence relevance scoring
2. Predictive evidence collection (suggest photos/documents before violations)
3. Outcome feedback loop to improve argument selection

