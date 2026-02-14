# Ticketless Chicago - Codebase Database Schema & Data Structures

## Executive Summary

Ticketless Chicago is a comprehensive Chicago parking and vehicle compliance management platform with three major subsystems:
1. **Vehicle Reminders & Renewals** - Tracks city stickers, emissions, license plates, etc.
2. **Ticket Contesting Automation** - Detects tickets and automatically generates contest letters
3. **FOIA Analytics** - Analyzes historical ticket contest outcomes from Chicago DOAH data

---

## 1. TICKET DETECTION & CONTESTING SYSTEM

### Core Tables

#### `detected_tickets` (Autopilot Ticket Detection)
Stores tickets detected from Vehicle Advocates (VA) automated monitoring service.

**Key Columns:**
- `id` (UUID) - Primary key
- `user_id` (UUID) - Ref to auth.users
- `plate` (VARCHAR) - License plate
- `state` (VARCHAR) - License plate state
- `ticket_number` (TEXT) - Ticket ID
- `violation_type` (VARCHAR) - e.g., 'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone', 'street_cleaning', 'rush_hour', 'fire_hydrant', 'red_light', 'speed_camera'
- `violation_code` (TEXT) - Chicago violation code
- `violation_description` (TEXT) - Human readable violation
- `violation_date` (DATE) - When violation occurred
- `due_date` (DATE) - Deadline to contest
- `amount` (DECIMAL) - Fine amount
- `fine_amount` (DECIMAL) - Same as amount
- `location` (TEXT) - Where ticket was issued
- `officer_badge` (TEXT) - Officer badge number
- `status` (VARCHAR) - 'found', 'needs_approval', 'evidence_received', 'pending_evidence', 'letter_generated', 'mailed', 'skipped', 'won', 'lost', 'failed'
- `skip_reason` (TEXT) - Why ticket was skipped
- `found_at` (TIMESTAMP) - When ticket was detected
- `user_evidence` (JSONB) - User uploaded evidence (photos, videos, attachments)
- `evidence_deadline` (DATE) - When evidence must be submitted
- `created_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)

**Purpose:** Central table tracking all detected tickets for contestation

**Related Queries Used In:**
- /pages/dashboard.tsx - Shows tickets overview
- /pages/tickets.tsx - List all tickets for user
- /pages/tickets/[id].tsx - Detail page with letter and delivery tracking
- /pages/admin/autopilot.tsx - Admin dashboard for all tickets

---

#### `contest_letters` (Generated Contest Letters)
Stores AI-generated or manually written contest letters for tickets.

**Key Columns:**
- `id` (UUID) - Primary key
- `ticket_id` (UUID) - Ref to detected_tickets
- `user_id` (UUID) - Ref to auth.users
- `letter_content` (TEXT) - Full letter text
- `letter_text` (TEXT) - Same as letter_content
- `letter_pdf_url` (TEXT) - URL to generated PDF
- `status` (VARCHAR) - 'draft', 'pending_approval', 'approved', 'rejected', 'sent', 'delivered', 'failed'
- `defense_type` (VARCHAR) - Type of defense used (e.g., 'procedural_defect', 'factual_error')
- `evidence_integrated` (BOOLEAN) - Whether user evidence was incorporated
- `evidence_integrated_at` (TIMESTAMP) - When evidence was added
- `mailed_at` (TIMESTAMP) - When sent to City Hall
- `lob_letter_id` (TEXT) - Lob.com letter ID for tracking
- `lob_status` (VARCHAR) - Lob delivery status: 'created', 'processing', 'in_transit', 'in_local_area', 'out_for_delivery', 'delivered', 'returned', 're_routed'
- `lob_expected_delivery` (DATE) - Estimated delivery date
- `delivery_status` (VARCHAR) - Same as lob_status
- `tracking_number` (TEXT) - USPS tracking number
- `expected_delivery_date` (DATE) - Expected delivery
- `delivered_at` (TIMESTAMP) - When delivered
- `last_tracking_update` (TIMESTAMP) - Last update time
- `created_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)

**Purpose:** Manages the lifecycle of contest letters from generation through delivery

**Related Tables:** Joins with `detected_tickets`, `user_profiles`

---

#### `ticket_contests` (User-Submitted Contest Challenges)
For users who manually submit their own contest challenges (separate from autopilot).

**Key Columns:**
- `id` (UUID)
- `user_id` (UUID)
- `ticket_photo_url` (TEXT) - Uploaded ticket photo
- `ticket_number` (TEXT)
- `violation_code` (TEXT)
- `violation_description` (TEXT)
- `ticket_date` (DATE)
- `ticket_amount` (DECIMAL)
- `ticket_location` (TEXT)
- `license_plate` (TEXT)
- `extracted_data` (JSONB) - OCR/LLM extracted ticket data
- `contest_letter` (TEXT) - User's contest letter
- `evidence_checklist` (JSONB) - Evidence items checklist
- `contest_grounds` (TEXT[]) - Array of contest reasons
- `status` (VARCHAR) - 'draft', 'pending_review', 'submitted', 'approved', 'denied', 'withdrawn'
- `attorney_requested` (BOOLEAN)
- `filing_method` (VARCHAR) - 'self', 'attorney', 'ticketless'
- `created_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)
- `submitted_at` (TIMESTAMP WITH TIME ZONE)
- `admin_notes` (TEXT)

**Purpose:** Tracks manual contest submissions from users

---

### Violation Type Categories
Used across `detected_tickets` and related tables:
- `expired_plates` - License plate expired
- `no_city_sticker` - Missing Chicago city sticker
- `expired_meter` - Expired parking meter
- `disabled_zone` - Parked in accessible zone
- `street_cleaning` - Parked during street cleaning
- `rush_hour` - Parked in rush hour zone
- `fire_hydrant` - Parked too close to hydrant
- `red_light` - Red light camera violation
- `speed_camera` - Speed camera violation
- `other_unknown` - Other violations

---

## 2. FOIA ANALYTICS SYSTEM

### Analytics Tables (Contest Outcome Statistics)

These tables store aggregated statistics from FOIA request data (2019-present) of Chicago DOAH ticket contests.

#### `violation_win_rates` (Win Rate by Violation Type)
**Key Columns:**
- `violation_code` (TEXT) - Chicago violation code (PK)
- `violation_description` (TEXT)
- `total_contests` (INTEGER) - Total cases filed
- `wins` (INTEGER) - Cases dismissed
- `losses` (INTEGER) - Cases upheld
- `denied` (INTEGER) - Cases denied
- `other` (INTEGER) - Other outcomes
- `win_rate_percent` (DECIMAL) - Percentage dismissed
- `win_rate_decided_percent` (DECIMAL) - Win rate of decided cases

**Purpose:** Shows which violation types are most winnable

**Used In:**
- FOIAAnalyticsDashboard.tsx - Displays top violations with win rates
- FOIATicketInsights.tsx - Shows violation-specific insights
- /api/foia/stats.ts - Backend endpoint returning this data

---

#### `officer_win_rates` (Win Rate by Officer)
**Key Columns:**
- `officer_badge` (TEXT) - Officer badge number (PK)
- `officer_name` (TEXT)
- `total_cases` (INTEGER)
- `wins` (INTEGER)
- `loss_rate_percent` (DECIMAL)
- `average_fine_amount` (DECIMAL)

**Purpose:** Identifies which officers issue most contestable tickets

---

#### `contest_method_win_rates` (Win Rate by Contest Method)
**Key Columns:**
- `contest_type` (VARCHAR) - Type of contest: 'written_hearing', 'administrative_hearing', 'court_hearing'
- `total_contests` (INTEGER)
- `wins` (INTEGER)
- `win_rate_percent` (DECIMAL)

**Purpose:** Shows which contest methods have highest success rates

**Used In:**
- FOIAAnalyticsDashboard.tsx - "Win Rate by Contest Method" section
- Shows breakdown like "Written hearing: X% win rate, Y wins out of Z contests"

---

#### `ward_win_rates` (Win Rate by Ward/Location)
**Key Columns:**
- `ward` (TEXT) - Chicago ward number (PK)
- `total_contests` (INTEGER)
- `wins` (INTEGER)
- `win_rate_percent` (DECIMAL)
- `average_fine_amount` (DECIMAL)
- `average_days_to_decision` (DECIMAL)

**Purpose:** Geographic analysis - shows which areas have stricter/more lenient enforcement

---

#### `dismissal_reasons` (Top Dismissal Reasons)
**Key Columns:**
- `reason` (TEXT) - Dismissal reason
- `count` (INTEGER) - How many times this reason was used
- `percentage` (DECIMAL) - Percentage of all dismissals
- `outcome` (VARCHAR) - 'dismissed', 'reduced', 'upheld'

**Purpose:** Most common reasons judges dismiss tickets

**Used In:**
- FOIAAnalyticsDashboard.tsx - "Top Dismissal Reasons" section
- Lists reasons like "Improper signage", "Parking sign unclear", etc.

---

### FOIA Data API Endpoints
Located at `/pages/api/foia/`:

- `stats.ts` - Main stats endpoint
  - Query params: `violation_code`, `type` ('violation'|'officer'|'method'|'ward'|'dismissal_reasons'|'overview')
  - Returns aggregated FOIA statistics
  
- `get-violation-stats.ts` - Violation-specific stats
  - Returns detailed win rates for specific violation codes

- `violation-stats-simple.ts` - Simplified violation stats

---

## 3. VEHICLE REMINDERS & RENEWALS SYSTEM

### Core Tables

#### `users` (Base User Data)
**Key Columns:**
- `id` (UUID) - Primary key, refs auth.users
- `email` (VARCHAR)
- `phone` (VARCHAR)
- `first_name` (VARCHAR)
- `last_name` (VARCHAR)
- `notification_preferences` (JSONB) - {sms, email, voice, reminder_days}
- `email_verified` (BOOLEAN)
- `phone_verified` (BOOLEAN)
- `subscription_status` (VARCHAR) - 'active', 'inactive', 'cancelled'

**Extended Fields (from migrations):**
- `license_plate` (VARCHAR)
- `vin` (VARCHAR)
- `zip_code` (VARCHAR)
- `vehicle_type` (VARCHAR)
- `vehicle_year` (INTEGER)
- `city_sticker_expiry` (DATE)
- `license_plate_expiry` (DATE)
- `emissions_date` (DATE)
- `street_address` (VARCHAR)
- `street_side` (VARCHAR) - 'even' or 'odd'
- `mailing_address` (VARCHAR)
- `mailing_city` (VARCHAR)
- `mailing_state` (VARCHAR)
- `mailing_zip` (VARCHAR)
- `concierge_service` (BOOLEAN) - Paid concierge service
- `city_stickers_only` (BOOLEAN)
- `spending_limit` (INTEGER)
- `created_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)

**Purpose:** Core user profile with vehicle and obligation tracking

---

#### `vehicles` (User Vehicles)
**Key Columns:**
- `id` (UUID) - Primary key
- `user_id` (UUID) - Ref to users
- `license_plate` (VARCHAR) - Unique per user
- `vin` (VARCHAR)
- `year` (INTEGER)
- `make` (VARCHAR)
- `model` (VARCHAR)
- `zip_code` (VARCHAR)
- `mailing_address` (VARCHAR)
- `mailing_city` (VARCHAR)
- `mailing_state` (VARCHAR)
- `mailing_zip` (VARCHAR)
- `subscription_id` (VARCHAR) - Stripe subscription ID
- `subscription_status` (VARCHAR) - 'active', 'cancelled', 'past_due'
- `created_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)

**Indexes:**
- idx_vehicles_user_id
- UNIQUE(user_id, license_plate)

**Purpose:** Stores user's registered vehicles

---

#### `obligations` (Compliance Deadlines)
**Key Columns:**
- `id` (UUID) - Primary key
- `vehicle_id` (UUID) - Ref to vehicles
- `user_id` (UUID) - Ref to users
- `type` (VARCHAR) - 'city_sticker', 'emissions', 'license_plate'
- `due_date` (DATE) - When obligation is due
- `auto_renew_enabled` (BOOLEAN)
- `completed` (BOOLEAN)
- `completed_at` (TIMESTAMP WITH TIME ZONE)
- `notes` (TEXT)
- `created_at` (TIMESTAMP WITH TIME ZONE)
- `updated_at` (TIMESTAMP WITH TIME ZONE)

**Indexes:**
- idx_obligations_due_date
- idx_obligations_user_id
- idx_obligations_vehicle_id
- idx_obligations_type
- idx_obligations_completed
- UNIQUE(vehicle_id, type, due_date)

**Purpose:** Tracks when vehicles need city sticker renewal, emissions test, license plate renewal

---

#### `reminders` (Sent Reminders Log)
**Key Columns:**
- `id` (UUID)
- `obligation_id` (UUID) - Ref to obligations
- `user_id` (UUID) - Ref to users
- `sent_at` (TIMESTAMP WITH TIME ZONE) - When reminder sent
- `method` (VARCHAR) - 'email', 'sms', 'voice'
- `days_until_due` (INTEGER) - Reminder timing (30, 14, 7, 3, 1, 0)
- `status` (VARCHAR) - 'sent', 'failed', 'bounced'
- `error_message` (TEXT) - If failed

**Purpose:** Log of all reminders sent to users

**Related Views:**
```sql
upcoming_obligations - View for reminders due in coming days
overdue_obligations - View for overdue obligations
```

---

## 4. PARKING LOCATION TRACKING SYSTEM

### Location Tables

#### `parking_location_history` (User Parking Sessions)
**Key Columns:**
- `id` (UUID)
- `user_id` (UUID)
- `latitude` (DECIMAL)
- `longitude` (DECIMAL)
- `address` (TEXT)
- `on_winter_ban_street` (BOOLEAN)
- `winter_ban_street_name` (TEXT)
- `on_snow_route` (BOOLEAN)
- `snow_route_name` (TEXT)
- `street_cleaning_date` (DATE) - Next cleaning date for this location
- `street_cleaning_ward` (VARCHAR) - Ward number
- `street_cleaning_section` (TEXT) - Section identifier
- `permit_zone` (VARCHAR) - Residential parking permit zone
- `permit_restriction_schedule` (TEXT)
- `parked_at` (TIMESTAMP)
- `cleared_at` (TIMESTAMP)
- `departure_latitude` (DECIMAL) - Location when user left
- `departure_longitude` (DECIMAL)
- `departure_confirmed_at` (TIMESTAMP)
- `departure_accuracy_meters` (DECIMAL)
- `departure_distance_meters` (DECIMAL) - Distance from parked location
- `created_at` (TIMESTAMP)

**Purpose:** Tracks where users park to analyze parking behavior and restrictions

---

#### `saved_parking_location` (User's Favorite Spots)
**Key Columns:**
- `id` (UUID)
- `user_id` (UUID)
- `latitude` (DECIMAL)
- `longitude` (DECIMAL)
- `address` (TEXT)
- `nickname` (TEXT) - "Home", "Office", etc.
- `icon` (TEXT)
- `color` (TEXT)
- `notify_on_arrival` (BOOLEAN)
- `has_restrictions` (BOOLEAN)
- `restriction_summary` (TEXT)
- `last_restriction_check` (TIMESTAMP)
- `times_parked` (INTEGER)
- `last_parked_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

**Purpose:** User's saved favorite parking locations with restriction info

---

#### `street_cleaning_schedule` (Chicago Street Cleaning Schedule)
**Key Columns:**
- `id` (UUID)
- `ward` (TEXT) - Ward number
- `section` (TEXT) - Section within ward
- `cleaning_date` (DATE) - When street cleaning occurs
- `street_name` (TEXT)
- `street_cleaning_ward` (TEXT)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

**Indexes:**
- idx_ward_section_date (ward, section, cleaning_date)
- idx_street_cleaning_ward_section
- idx_street_cleaning_composite

**Purpose:** Look up street cleaning dates for specific Chicago locations by ward/section

---

#### `parking_permit_zones` (Chicago Permit Zone Reference)
Synced from Chicago Open Data Portal
- Row ID, status, zone, odd/even, address range, street direction, street name, type, buffer, ward range

**Purpose:** Reference data for checking if parking location requires permit

---

## 5. ADDITIONAL SUPPORT TABLES

### Attorney/Professional Services

#### `attorneys` (Attorney Directory)
- `full_name`, `law_firm`, `email`, `phone`
- `bar_number`, `bar_state`, `years_experience`, `specializations[]`
- `accepting_cases`, `response_time_hours`
- `consultation_fee`, `flat_fee_parking`, `flat_fee_traffic`, `hourly_rate`
- `total_cases_handled`, `total_cases_won`, `win_rate`
- `total_reviews`, `average_rating`
- `verified`, `featured`, `status` ('active', 'inactive', 'suspended')
- `created_at`, `updated_at`

#### `attorney_case_expertise` (Attorney Specializations)
- `attorney_id`, `violation_code`
- `cases_handled`, `cases_won`, `win_rate`

#### `attorney_reviews` (User Attorney Reviews)
- `attorney_id`, `user_id`, `rating` (1-5)
- `communication_rating`, `professionalism_rating`, `value_rating`
- `review_text`, `case_outcome`, `would_recommend`
- `verified`, `hidden`

#### `attorney_quote_requests` (Quote Request Workflow)
- `attorney_id`, `user_id`, `user_name`, `user_email`
- `violation_code`, `ticket_amount`, `case_description`
- `urgency` ('urgent', 'normal', 'not_urgent')
- `status` ('pending', 'responded', 'accepted', 'declined', 'completed')
- `attorney_response`, `quote_amount`, `estimated_duration`
- `responded_at`, `created_at`, `updated_at`

---

### Win Rate Statistics

#### `win_rate_statistics` (Aggregated Statistics)
- `stat_type`, `stat_key` (UNIQUE)
- `total_cases`, `dismissed_count`, `reduced_count`, `upheld_count`
- `win_rate`, `dismissal_rate`, `reduction_rate`
- `avg_reduction_percentage`, `avg_days_to_decision`
- `sample_size_adequate`, `last_calculated`

---

### Admin & Audit Tables

#### `audit_logs` (Action Audit Trail)
- `user_id`, `admin_user_id`
- `action_type` ('document_reviewed', 'renewal_filed', 'payment_processed', etc.)
- `entity_type`, `entity_id`
- `action_details` (JSONB)
- `status` ('success', 'failure', 'pending')
- `error_message`
- `ip_address`, `user_agent`
- `created_at`

**Indexes:** By user_id, action_type, entity_type+id, created_at DESC

---

#### `reimbursement_requests` (Ticket Reimbursement Requests)
- `user_id`, `email`, `first_name`, `last_name`
- `license_plate`, `ticket_number`, `ticket_date`
- `ticket_amount`, `ticket_type` ('street_cleaning', 'city_sticker', etc.)
- `front_photo_url`, `back_photo_url`
- `status` ('pending', 'approved', 'denied', 'paid')
- `reimbursement_amount`, `admin_notes`
- `payment_method`, `payment_details`
- `processed_by`, `processed_at`
- `created_at`, `updated_at`

**RLS:** Users see own; admins see all

---

#### `affiliate_commission_tracker`
- `stripe_session_id` (UNIQUE)
- `customer_email`, `plan`, `total_amount`
- `expected_commission`, `referral_id`
- `commission_adjusted`, `adjusted_by`, `adjusted_at`

**Purpose:** Track affiliate commissions and prevent double-counting

---

### Subscription & Property Tax

#### `property_tax_deadlines`
- `property_address`, `year`
- `deadline_date` (DATE)
- `status` ('unknown', 'confirmed', 'expired')

#### `property_tax_appeals`
- `user_id`, `property_address`, `year`
- `appeal_reason`, `amount_challenged`
- `status` ('pending', 'paid', 'letter_generated')
- `stripe_payment_intent_id`, `stripe_session_id`
- `paid_at`, `letter_generated_at`

**Indexes:** On stripe_payment_intent_id (UNIQUE for duplicate prevention)

---

#### `autopilot_subscriptions` (Active Subscriptions for VA Monitoring)
- `user_id`, `license_plate`
- `status` ('active', 'cancelled', 'suspended')
- `subscription_start_date`, `subscription_end_date`

---

#### `monitored_plates` (Plates Being Monitored for Tickets)
- `user_id`, `license_plate`
- `status` ('active', 'inactive')
- `monitoring_start_date`

---

### Notification & Communication

#### `notification_logs`
- Tracks notification attempts (email, SMS, push)
- `user_id`, `notification_type`, `method`
- `status` ('sent', 'failed', 'bounced')
- `sent_at`, `delivered_at`

#### `incoming_sms` (SMS Webhook Storage)
- Raw incoming SMS for webhook handlers

#### `push_tokens` (Device Push Notification Tokens)
- `user_id`, `device_token`, `platform` (iOS, Android)

---

### Data Storage

#### `plate_export_jobs` (Batch Export Jobs)
- Tracks jobs for exporting monitored plates

#### `va_uploads` (Vehicle Advocate Upload Logs)
- Tracks ticket data uploaded from VA monitoring service

---

## 6. GEOGRAPHIC/LOCATION DATA

### Ward & Section Data Structure
Chicago-specific geographic hierarchy:
- **Ward** (1-50) - City political districts
- **Section** - Subdivision of ward for street cleaning
- Used in:
  - `street_cleaning_schedule` - Which streets clean which dates
  - `parking_location_history` - Tracks location restrictions
  - `ward_win_rates` - Analytics by ward
  - `user_profiles` - `home_address_ward` field

### PostGIS Functions
File: `/add-postgis-function.sql` - Includes geographic functions to:
- Lookup ward/section from coordinates
- Find parking restrictions by location
- Identify street cleaning dates

---

## 7. EXISTING ANALYTICS & DASHBOARD FEATURES

### Admin Dashboard Pages

#### `/pages/dashboard.tsx` (Main Admin Dashboard)
Shows:
- Ticket detection overview
- Tickets by status
- Recent tickets
- Letter generation status
- User activity

Queries: `detected_tickets`, `contest_letters`, `user_profiles`

---

#### `/pages/admin/autopilot.tsx` (Autopilot Monitoring Dashboard)
Shows:
- Active subscriptions count
- Monitored plates count
- Pending tickets needing approval
- Letters sent/delivered stats
- Pending evidence tickets

Queries: `/api/admin/autopilot/stats`

---

#### `/components/FOIAAnalyticsDashboard.tsx` (Contest Analytics)
Shows:
- Total contested tickets: ~5000+ from FOIA data
- Win rate by contest method
- Top dismissal reasons
- Violations by win rate
- Statistical analysis of DOAH cases

Queries: `/api/foia/stats?type=overview`

---

#### `/components/FOIATicketInsights.tsx` (Violation-Specific Insights)
For each violation type shows:
- Win rate percentage
- Number of cases
- Likelihood of success
- Common dismissal reasons for that violation

---

### Analytics API Endpoints

#### `/pages/api/admin/autopilot/stats.ts`
Returns:
- usersCount - Active autopilot subscribers
- platesCount - Monitored license plates
- pendingTickets - Tickets detected pending approval
- pendingEvidence - Tickets waiting for user evidence
- lettersSent - Contest letters delivered
- pendingEvidenceTickets - Next 20 needing evidence
- exportJobs - Recent batch exports
- vaUploads - Recent ticket uploads

---

#### `/pages/api/foia/stats.ts`
Returns aggregated statistics:
- `type=overview` - Summary stats with contest methods, dismissal reasons
- `type=violation` - Top 50 violations by win rate
- `type=violation&violation_code=XXX` - Specific violation stats
- `type=officer` - Officer statistics
- `type=method` - Contest method win rates
- `type=ward` - Geographic win rate data
- `type=dismissal_reasons` - Top 20 dismissal reasons

---

#### `/pages/api/admin/ticket-pipeline.ts`
Returns tickets with computed stage:
- ticket_detected - Just found
- letter_generated - Letter created but no evidence
- evidence_letter_generated - Evidence incorporated
- letter_sent - Mailed to City Hall

Enriched with:
- User info, violation details, delivery tracking
- Evidence status and deadline

---

#### `/pages/api/admin/contest-letters.ts`
Returns contest letters with:
- Filters: status, evidence_integrated
- Pagination: limit, offset
- Enriched with user email, ticket info

---

## 8. KEY DATA RELATIONSHIPS

```
auth.users
  ├─> users (extended user profile)
  ├─> vehicles (registered vehicles)
  │    └─> obligations (renewal deadlines)
  │         └─> reminders (notification log)
  │
  ├─> detected_tickets (autopilot found)
  │    └─> contest_letters (generated letters)
  │         └─> lob tracking (delivery status)
  │
  ├─> ticket_contests (user-submitted contests)
  │
  ├─> parking_location_history (where user parked)
  │    └─> street_cleaning_schedule (restrictions)
  │    └─> parking_permit_zones (reference data)
  │    └─> saved_parking_location (favorites)
  │
  ├─> property_tax_deadlines (property obligations)
  │    └─> property_tax_appeals (appeals filed)
  │
  ├─> attorney_quote_requests
  │    └─> attorneys (directory)
  │         └─> attorney_case_expertise
  │         └─> attorney_reviews
  │
  └─> autopilot_subscriptions
       └─> monitored_plates

FOIA Data Tables (read-only reference):
  ├─> violation_win_rates (aggregated stats)
  ├─> officer_win_rates
  ├─> contest_method_win_rates
  ├─> ward_win_rates
  └─> dismissal_reasons
```

---

## 9. IMPORTANT INDEXES & PERFORMANCE

**High-traffic indexes:**
- `detected_tickets(status)` - Filter by pipeline stage
- `detected_tickets(user_id, created_at DESC)` - User's tickets
- `contest_letters(ticket_id)` - Join with tickets
- `parking_location_history(user_id, parked_at DESC)` - User's history
- `street_cleaning_schedule(ward, section, cleaning_date)` - Location lookup
- `violation_win_rates(violation_code)` - Analytics lookups
- `audit_logs(action_type, created_at DESC)` - Audit trail

---

## 10. ROW LEVEL SECURITY (RLS) POLICIES

**Tables with RLS Enabled:**
- `users` - Users see own records
- `vehicles` - Users see own vehicles
- `obligations` - Users see own obligations
- `detected_tickets` - Users see own detected tickets
- `contest_letters` - Users see own letters
- `ticket_contests` - Users see own contests
- `parking_location_history` - Users see own history
- `parking_permit_zones` - Public read access
- `reimbursement_requests` - Users see own, admins see all
- `attorney_reviews` - Users create own, view non-hidden
- `audit_logs` - Service role only, accessed via admin APIs

**Admin/Service Role Bypass:**
- Admins: `auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'carenvollrath@gmail.com')`
- Service role: Full unrestricted access

---

## 11. CRON JOBS & BACKGROUND PROCESSES

### Autopilot Cron Jobs
Located in `/pages/api/cron/`:

#### `autopilot-mail-letters.ts`
- Sends approved letters via Lob.com
- Queries: `contest_letters` (status='approved')
- Updates delivery tracking

#### `autopilot-generate-letters.ts`
- Generates contest letters from detected tickets
- Sends approval emails to users
- Queries: `detected_tickets` with evidence
- Creates: `contest_letters`

#### `autopilot-check-plates.ts`
- Checks monitored plates for new tickets
- Integrates with Vehicle Advocates API

#### `process-video-queue.ts`
- Processes video evidence uploads

---

## 12. MISSING/FUTURE OPPORTUNITIES

Based on the codebase, these features are ready to be enhanced:

1. **Ward-level Analytics Dashboard** - Use `ward_win_rates` to show which wards have best outcomes
2. **Predictive Win Rate** - Show user the likelihood of winning their specific ticket
3. **Optimization Suggestions** - "You'd have better odds with a written hearing"
4. **Time Series Analytics** - Track how win rates change over time
5. **Officer Analysis** - "This officer's tickets win 60% of the time"
6. **Violation Type Recommendations** - "We recommend the procedural defect defense"
7. **Location-based Parking Alerts** - Warn users about problem parking areas
8. **Comparative Analytics** - "Your ward vs city average"
9. **Batch Export/Reporting** - Generate reports for multiple users

---

## 13. IMPORTANT FILES REFERENCE

**Key Type Definitions:**
- `/types/index.ts` - Main TypeScript interfaces

**Migration Scripts:**
- `/supabase/migrations/` - All database migrations
- `/database-migration-final.sql` - Latest schema

**API Endpoints:**
- `/pages/api/admin/` - Admin-only endpoints
- `/pages/api/foia/` - Public analytics endpoints
- `/pages/api/cron/` - Background jobs
- `/pages/api/autopilot/` - Autopilot service endpoints

**UI Components:**
- `/components/FOIAAnalyticsDashboard.tsx` - Main analytics UI
- `/components/FOIATicketInsights.tsx` - Violation insights
- `/pages/dashboard.tsx` - Main dashboard
- `/pages/tickets.tsx` - Ticket list

---

## Summary Statistics

**Tables:** 35+
**Key Entities:** Users, Vehicles, Obligations, Detected Tickets, Contest Letters, FOIA Stats
**Data Volume:** ~5000+ FOIA historical records, unlimited ticket detection capacity
**Primary Use Case:** Chicago parking ticket automation and contestation
**Geographic Focus:** Chicago wards 1-50, street cleaning zones
**Analytics Scope:** 2019-present DOAH contest outcomes

