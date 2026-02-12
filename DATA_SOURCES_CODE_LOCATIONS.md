# Data Sources - Code Location Reference

Quick lookup for where each data source is accessed, processed, and used in the codebase.

## Email & Receipt Forwarding

### City Sticker Receipts (`city_sticker_receipts`)
- **Webhook Handler**: `/pages/api/webhooks/evidence-email.ts`
- **Storage**: Supabase Storage (S3)
- **Used In**: `/lib/contest-kits/city-sticker.ts`
- **Email Parsing**: `pages/api/email/forward.ts`

### Registration Evidence (`registration_evidence_receipts`)
- **Webhook Handler**: `/pages/api/webhooks/evidence-email.ts`, `/pages/api/webhooks/resend-incoming-email.ts`
- **OCR Processing**: `lib/contest-intelligence/evidence-analysis.ts`
- **Evidence Types**: 
  - `source_type = 'city_sticker'` - City sticker receipts
  - `source_type = 'license_plate'` - License plate stickers

### Utility Bills (via Email Forwarding)
- **Parsed In**: `pages/api/email/process-residency-proof.ts`
- **Stored In**: `registration_evidence_receipts` (parsed fields)
- **Used For**: Residential permit proofs, city sticker residency

---

## Parking Detection & Location Data

### Parking History (Mobile Detection)
- **iOS Collection**: 
  - `/TicketlessChicagoMobile/src/services/BackgroundLocationModule.swift` (CoreLocation + CMMotionActivityManager)
  - `BackgroundTaskService.ts` - Orchestration
  - `ParkingDetectionStateMachine.ts` - State management
  
- **Android Collection**:
  - `BluetoothMonitorService.kt` - Bluetooth disconnect detection
  - `BackgroundLocationService.ts` - Location tracking
  - `ParkingDetectionStateMachine.ts` - State management

- **API Endpoints**:
  - `pages/api/mobile/save-parked-location.ts` - Save parking
  - `pages/api/mobile/confirm-departure.ts` - Confirm departure
  - `pages/api/mobile/parking-history.ts` - Fetch history
  - `pages/api/mobile/parking-history/[id].ts` - Get specific record

- **Evidence Lookup**:
  - `lib/parking-evidence.ts` - Find parking evidence for ticket
  - Used in `pages/api/contest/generate-letter.ts` for letter generation

### Camera Pass History (`camera_pass_history`)
- **Collection Endpoint**: `/pages/api/mobile/check-parking.ts`
- **Mobile Service**: `CameraAlertService.ts` (detects when passing camera)
- **Query Endpoint**: `/pages/api/intelligence/dashboard.ts`
- **Used In**: Minimal - needs expansion

### Red Light Receipts (`red_light_receipts`)
- **Mobile Collection**: `RedLightReceiptService.ts`
- **Service Provider**: Mobile app traces intersection passes
- **Fields**:
  - `trace` (JSONB) - Full speed/position history
  - `full_stop_detected` (BOOLEAN)
  - `approach_speed_mph`, `min_speed_mph`
- **Used In**: Minimal - `trace` field entirely unused

---

## Weather & Environmental Data

### Historical Weather Data
- **Service**: `lib/weather-service.ts`
- **Data Source**: National Weather Service API (free)
- **Fallback**: OpenWeatherMap (OPENWEATHERMAP_API_KEY env var)
- **Functions**:
  - `getHistoricalWeather(date: string)` - Get weather for specific date
  - `getSnowfallData()` - Check for snow
  - `formatSnowStartTime()` - Human-readable format
  
- **Used In**:
  - `pages/api/contest/generate-letter.ts` (main integration)
  - `lib/contest-kits/street-cleaning.ts` - Street cleaning defenses
  - `lib/contest-kits/snow-route.ts` - Snow route defenses
  
- **Weather Relevance Mapping** (in generate-letter.ts):
  ```
  '9-64-010': 'primary',    // Street Cleaning - cancelled in bad weather
  '9-64-100': 'primary',    // Snow Route - threshold must be met
  '9-64-170': 'supporting', // Expired Meter - hard to return in storm
  // ... etc
  ```

### Street Cleaning Schedule (`street_cleaning_schedule`)
- **Data Source**: Chicago open data portal + scripts
- **Table**: Supabase public.street_cleaning_schedule
- **Migration**: `sql/create-street-cleaning-schedule-table.sql`
- **Ingestion Scripts**:
  - `scripts/execute-meter-inserts.ts`
  - `scripts/validate-all-meters.ts`
  
- **Used In**:
  - `lib/contest-kits/street-cleaning.ts` - Check if cleaning scheduled
  - `lib/unified-parking-checker.ts` - Determine restrictions at location
  - `pages/api/metered-parking.ts` - Meter lookup
  - `TicketlessChicagoMobile/src/services/parking-map/` - Mobile display

### Snow Routes & Winter Restrictions
- **Tables**: `snow_routes`, `snow_route_status`, `snow_events`, `storm_events`
- **Used In**:
  - `lib/contest-kits/snow-route.ts`
  - `lib/winter-ban-checker.ts`
  - `TicketlessChicagoMobile/src/services/realtime/SnowEmergencyMonitor.ts`

---

## Court & Hearing Officer Intelligence

### Ward Contest Intelligence
- **Table**: `ward_contest_intelligence`
- **Fields**: win_rates, violation_stats, defense_stats, enforcement_score, etc.
- **Accessed In**:
  - `lib/contest-intelligence/ward-intelligence.ts`
  - `pages/api/intelligence/` endpoints

### Hearing Officer Patterns
- **Table**: `hearing_officer_patterns`
- **Fields**: dismissal_rate, defense_acceptance, evidence_preferences, strictness_score
- **Accessed In**:
  - `lib/contest-intelligence/hearing-officers.ts`
  - Used to shape letter tone

### Signage Reports
- **Table**: `signage_reports`
- **Fields**: Location, sign_condition, photo_urls, contest_win_rate
- **Accessed In**:
  - `lib/contest-intelligence/signage-database.ts`
  - **NOT YET**: Geospatial query for signs near ticket location

### Court Case Outcomes
- **Table**: `court_case_outcomes` (inferred)
- **Accessed In**: `pages/api/contest/generate-letter.ts`
  ```typescript
  const { data: allSuccessfulCases } = await supabase
    .from('court_case_outcomes')
    .select('*')
    .eq('violation_code', violationCode)
    .in('outcome', ['dismissed', 'reduced'])
  ```

### FOIA Requests
- **Table**: `ticket_foia_requests`
- **Migration**: `supabase/migrations/20260210143000_create_ticket_foia_requests.sql`
- **Status**: Infrastructure created, process not yet implemented
- **Potential**: `pages/api/cron/autopilot-generate-letters.ts` could trigger FOIA generation

---

## User Vehicle & Registration Data

### User Profiles (Vehicle Info)
- **Table**: `user_profiles`
- **Fields**: license_plate, vehicle_make/model/year/color, license_type, VIN
- **Accessed In**:
  - `lib/database.types.ts` - Core type definition
  - `pages/api/profile.ts` - Profile endpoints
  - `pages/api/user-profile.ts`
  - Used in all letter generation for vehicle verification

### User Addresses (Residency)
- **Table**: `user_addresses`
- **Used In**: 
  - `pages/api/protection/` - Residential permit verification
  - `pages/api/permit-zone/` - Permit zone eligibility
  - `lib/contest-kits/residential-permit.ts`

---

## Evidence & Document Uploads

### User-Uploaded Evidence
- **Bucket**: `ticket_photos`, `evidence_uploads`
- **Upload Endpoint**: `/pages/api/contest/upload-evidence.ts`
- **Video Processing**: `pages/api/cron/process-video-queue.ts`
- **Analysis**: `lib/contest-intelligence/evidence-analysis.ts`
  - OCR extraction (dates, amounts, numbers)
  - Condition classification
  - Relevance scoring

### Residency Proof Documents
- **Bucket**: `residency_proofs`
- **Processing**: `pages/api/email/process-residency-proof.ts`
- **Validation**: `pages/api/protection/validate-residency-proof.ts`

### Vehicle Registration Documents
- **Buckets**: `registration_documents`, `license_images`
- **Upload**: `pages/api/protection/upload-license.ts`
- **Cleanup**: `pages/api/cron/cleanup-license-images.ts`

---

## Ticket & Contest Tracking

### Detected Tickets
- **Table**: `detected_tickets`
- **Discovery**: `scripts/autopilot-check-portal.ts` (portal scraper)
- **Creation**: `pages/api/contest/upload-ticket.ts`
- **Portal Data**: `lib/chicago-portal-scraper.ts`

### Ticket Contests
- **Table**: `ticket_contests`
- **Letter Generation**: `pages/api/contest/generate-letter.ts`
- **Outcome Recording**: `pages/api/contest/report-outcome.ts`

### Contest Letters
- **Generation**: `pages/api/contest/generate-letter.ts`
- **PDF Generation**: `lib/pdf-letter-generator.ts`
- **Mailing**: `pages/api/cron/autopilot-mail-letters.ts`
- **Admin View**: `pages/admin/contest-letters.tsx`

---

## Utility & Financial Data

### Utility Bills (from email forwarding)
- **Email Parsing**: `pages/api/email/process-residency-proof.ts`
- **Storage**: `registration_evidence_receipts`
- **OCR Fields**: `parsed_purchase_date`, `parsed_amount_cents`

---

## Signage & Street Data

### Permit Zone Geometries
- **Table**: `parking_permit_zones`
- **PostGIS**: geometry column with polygon data
- **Used In**:
  - `lib/permit-zone-messaging.ts`
  - Geospatial queries for location-based checks

### Snow Routes (Spatial)
- **Table**: `snow_routes`
- **PostGIS**: geometry column with linestring data
- **Used In**:
  - Geospatial queries to find routes containing location

---

## Messaging & Logs

### Email Logs
- **Table**: `email_logs`
- **Creation**: Throughout codebase when emails sent
- **Used In**: Operational only (not contests)

### SMS Logs
- **Table**: `sms_logs`, `incoming_sms`
- **Inbound Handler**: `pages/api/sms/inbound.ts`
- **Used In**: Operational alerts (not contests)

---

## Towed Vehicles

### Towed Vehicles Data
- **Table**: `towed_vehicles`
- **Sync Job**: `pages/api/cron/sync-relocation-data.ts`
- **Alerts**: `pages/api/cron/check-towed-vehicles.ts`
- **Used In**: Alert system only
- **Unused In**: Contest letters (opportunity for enforcement pattern args)

---

## Autopilot & Automation

### Portal Scraper
- **Service**: `lib/chicago-portal-scraper.ts`
- **Uses**: Puppeteer to automate portal login and search
- **Returns**: Ticket list (no captcha solving needed)
- **Used In**: `scripts/autopilot-check-portal.ts` (cron job)

### Autopilot Letter Generation
- **Cron Job**: `pages/api/cron/autopilot-generate-letters.ts`
- **Process**:
  1. Fetch monitored plates from config
  2. Run portal scraper
  3. Find new tickets
  4. Check contestability (within deadline)
  5. Generate letters
  6. Queue for mailing

### Autopilot Mailing
- **Cron Job**: `pages/api/cron/autopilot-mail-letters.ts`
- **Service**: Lob for physical letter printing & mailing
- **Configuration**: `lib/lob-service.ts`

---

## Key Files for Contest Letter Enhancement

### Core Letter Generation
- `pages/api/contest/generate-letter.ts` - Main engine (600+ lines)
- `lib/parking-evidence.ts` - Parking evidence lookup
- `lib/contest-kits/` - Violation-specific logic
  - `index.ts` - Kit dispatcher
  - `street-cleaning.ts` - Street cleaning defenses
  - `snow-route.ts` - Snow route defenses
  - `city-sticker.ts` - City sticker defenses
  - etc.

### Supporting Services
- `lib/contest-intelligence/evidence-analysis.ts` - OCR + pattern extraction
- `lib/contest-intelligence/letter-scoring.ts` - Quality scoring
- `lib/contest-intelligence/hearing-officers.ts` - Officer lookup
- `lib/weather-service.ts` - Weather data fetching

### Autopilot System
- `scripts/autopilot-check-portal.ts` - Ticket discovery
- `pages/api/cron/autopilot-generate-letters.ts` - Letter generation
- `pages/api/cron/autopilot-mail-letters.ts` - Letter mailing

---

## Environment Variables Required

```
NEXT_PUBLIC_SUPABASE_URL=https://dzhqolbhuqdcpngdayuq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=... (for letter generation)
LOB_API_KEY=... (for physical mailing)
OPENWEATHERMAP_API_KEY=... (optional, NWS is primary)
```

---

## Database Connection Patterns

### Service Role Client (Admin)
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### User Auth Client
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

---

## Table Schema Reference

Full schema details in `/lib/database.types.ts` (1000+ lines)

Key tables for contests:
- `ticket_contests` - Contest tracking
- `detected_tickets` - Discovered tickets
- `contest_letters` - Generated letters
- `user_profiles` - Vehicle & user info
- `city_sticker_receipts` - Forwarded sticker receipts
- `registration_evidence_receipts` - OCR-extracted evidence
- `parking_history` - Parking events (inferred table)
- `camera_pass_history` - Camera passes
- `red_light_receipts` - Red light camera data
- `street_cleaning_schedule` - Daily cleaning schedule
- `snow_routes` - Snow emergency routes
- `parking_permit_zones` - Permit zone boundaries
- `signage_reports` - User-reported signs
- `ward_contest_intelligence` - Ward win rates
- `hearing_officer_patterns` - Officer patterns

