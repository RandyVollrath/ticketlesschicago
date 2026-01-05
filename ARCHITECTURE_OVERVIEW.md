# Ticketless Chicago - Existing Architecture Overview

## Project Overview
Ticketless Chicago is a multi-feature civic tech platform running on Next.js with a React Native mobile app. It provides services for:
- Parking ticket contesting (with AI analysis and attorney partnerships)
- City sticker and license plate renewal (with subscription model)
- Parking and street cleaning notifications
- Property tax utilities (for residency proof)
- Winter parking ban alerts
- Multi-city expansion (Chicago, Boston, SF, LA, San Diego)

**Tech Stack:**
- Frontend: Next.js (pages-based), React
- Mobile: Expo/React Native (TypeScript)
- Backend: Next.js API routes
- Database: Supabase (PostgreSQL)
- Authentication: Supabase Auth
- Payments: Stripe (subscriptions and one-time charges)
- Communications: Resend (email), ClickSend (SMS/voice), FCM (push)
- Document Processing: Claude Vision for OCR, Anthropic for content generation
- Mailing: Lob.com for physical mail
- External: Cook County Assessor API (property tax lookup)

---

## 1. DATABASE SCHEMA ARCHITECTURE

### Core User Tables

#### `auth.users` (Supabase Auth)
- UUID primary key
- Email authentication
- Password/OAuth support
- Standard Supabase auth fields

#### `user_profiles`
Central user profile table with extensive fields:
```sql
user_id UUID -- FK to auth.users
first_name, last_name
email, phone_number
license_plate, license_plate_type (passenger, motorcycle, etc.)
vin, street_address, zip_code, city
city_sticker_expiry, license_plate_expiry, emissions_date
-- Permit Zone Features
has_permit_zone, permit_zone_number, permit_zone_documents
-- Protection Subscription
has_protection, stripe_customer_id, stripe_subscription_id, subscription_status
protection_started_at, protection_canceled_at
-- Residency Proof (for permit zone requirements)
residency_proof_type, residency_proof_path, residency_proof_verified
-- Property Tax Tracking
property_tax_last_fetched_at, property_tax_needs_refresh, property_tax_fetch_failed
-- Notifications
notify_email, notify_sms, phone_call_enabled
notification_preferences (JSONB)
-- Email Forwarding (for utility bills)
email_forwarding_address, residency_forwarding_enabled
-- Various renewal fields
license_plate_renewal_cost, license_plate_is_personalized, license_plate_is_vanity
city_sticker_purchase_confirmed_at
profile_confirmed_at
vehicle_type, trailer_weight, rv_weight, emissions_completed
```

### Ticket Contesting Tables

#### `ticket_contests`
User submissions for contesting parking/traffic tickets:
```sql
id UUID PK
user_id UUID -- FK to auth.users
ticket_photo_url -- URL to uploaded ticket image
ticket_number, violation_code, violation_description
ticket_date, ticket_amount, ticket_location, license_plate
extracted_data JSONB -- Claude Vision OCR output
contest_letter TEXT -- AI-generated letter
evidence_checklist JSONB -- {photos, witnesses, docs}
contest_grounds TEXT[] -- e.g., signage_unclear, incorrect_violation
status TEXT -- draft, pending_review, submitted, approved, denied, withdrawn
attorney_requested BOOLEAN
filing_method TEXT -- self, attorney, ticketless (platform mailers)
evidence_photos JSONB[], supporting_documents JSONB[]
created_at, updated_at, submitted_at
admin_notes TEXT
```

#### `court_case_outcomes`
Historical court data for win probability analysis:
```sql
case_number, ticket_number
violation_code, violation_description, ticket_amount
ticket_location, ward
outcome TEXT -- dismissed, reduced, upheld, withdrawn, pending
original_amount, final_amount, reduction_percentage
contest_grounds TEXT[], defense_strategy, evidence_submitted JSONB
attorney_represented BOOLEAN
ticket_date, contest_filed_date, hearing_date, decision_date, days_to_decision
judge_name, hearing_officer_name
data_source TEXT -- manual, scraped, user_reported
verified BOOLEAN, scrape_date
```

#### `win_rate_statistics`
Materialized view for win probabilities:
```sql
stat_type TEXT -- violation_code, ward, judge, contest_ground, month, evidence_type
stat_key TEXT -- e.g., "9-64-010" or "Judge Smith"
total_cases, dismissed_count, reduced_count, upheld_count
win_rate, dismissal_rate, reduction_rate
avg_reduction_percentage, avg_days_to_decision
sample_size_adequate BOOLEAN -- true if cases >= 30
last_calculated TIMESTAMPTZ
```

### Attorney Partnership Tables

#### `attorneys`
Attorney marketplace:
```sql
id UUID PK
full_name, law_firm, email, phone
bar_number, bar_state, years_experience
specializations TEXT[] -- parking_tickets, traffic_violations, municipal_law
office_address, service_areas TEXT[]
accepting_cases BOOLEAN, response_time_hours
consultation_fee, flat_fee_parking, flat_fee_traffic, hourly_rate
pricing_model TEXT -- flat_fee, hourly, contingency, hybrid
total_cases_handled, total_cases_won, win_rate DECIMAL
avg_reduction_percentage, avg_case_duration_days
total_reviews, average_rating
bio, profile_photo_url, website_url, linkedin_url
verified BOOLEAN, featured BOOLEAN, status TEXT
created_at, updated_at
```

#### `attorney_case_expertise`
Attorney specialization tracking:
```sql
id UUID PK
attorney_id UUID
violation_code TEXT
cases_handled, cases_won, win_rate
```

#### `attorney_reviews`
User reviews of attorneys:
```sql
id UUID PK
attorney_id, user_id, contest_id
rating 1-5, review_text
communication_rating, professionalism_rating, value_rating
case_outcome TEXT -- dismissed, reduced, upheld, withdrawn
would_recommend BOOLEAN
verified_client, flagged, hidden
```

#### `attorney_quote_requests`
Attorney quote system:
```sql
id UUID PK
user_id, contest_id, attorney_id
violation_code, ticket_amount, description, urgency
status TEXT -- pending, attorney_viewed, quote_provided, accepted, declined, expired
quoted_amount, quote_details, quote_expires_at
attorney_viewed_at, quote_provided_at, user_responded_at
```

### City Sticker Renewal Tables

#### `renewal_partners`
Partner organizations (remitters, dealerships, currency exchanges):
```sql
id UUID PK
name, business_type -- remitter, dealership, currency_exchange
email, phone, business_address
license_number, ein
stripe_connected_account_id, stripe_account_status
payout_enabled BOOLEAN
api_key, webhook_url, portal_integration_type
portal_credentials_encrypted TEXT
auto_forward_payments BOOLEAN, commission_percentage, service_fee_amount
allow_digital_intake, require_appointment, allow_walk_in
status TEXT -- active, suspended, inactive
onboarding_completed BOOLEAN
created_at, updated_at
```

#### `renewal_orders`
Digital city sticker renewal orders:
```sql
id UUID PK
order_number TEXT -- RS-2025-123456
partner_id UUID
customer_name, customer_email, customer_phone
license_plate, license_state, vin, make, model, year
street_address, city, state, zip_code, ward
documents JSONB[] -- array of document objects {type, url, filename, uploaded_at, verified}
sticker_type, sticker_price, service_fee, total_amount
stripe_payment_intent_id, stripe_transfer_id
payment_status TEXT -- pending, paid, failed, refunded
status TEXT -- submitted, documents_verified, payment_received, sent_to_city, sticker_ready, completed, rejected, cancelled
pushed_to_portal BOOLEAN, pushed_to_portal_at, portal_confirmation_number
sticker_number, sticker_issued_at, sticker_expires_at
fulfillment_method TEXT -- mail, pickup
shipped_at, tracking_number, delivered_at
notifications_sent JSONB[] -- array of notification events
created_at, updated_at, completed_at
```

#### `renewal_document_reviews`
Document verification queue:
```sql
id UUID PK
order_id UUID
document_type TEXT, document_url TEXT
status TEXT -- pending, approved, rejected
reviewed_by, reviewed_at, rejection_reason
auto_verified BOOLEAN, auto_verification_confidence DECIMAL
extracted_data JSONB -- OCR data
```

#### `renewal_order_activity_log`
Audit log for renewal orders:
```sql
id UUID PK
order_id UUID
activity_type TEXT -- order_created, document_uploaded, payment_received, sent_to_portal, status_changed
description TEXT
old_value, new_value
performed_by UUID, performed_by_type TEXT -- system, customer, admin, partner
metadata JSONB
created_at
```

### Subscription & Payment Tables

#### `renewal_charges`
Payment transaction tracking:
```sql
id UUID PK
user_id UUID
charge_type TEXT -- subscription, sticker_renewal, license_plate_renewal, remitter_onetime
amount DECIMAL, currency TEXT
stripe_payment_intent_id, stripe_charge_id, stripe_invoice_id
status TEXT -- pending, succeeded, failed, refunded
failure_reason, failure_code
remitter_partner_id UUID, remitter_received_amount, platform_fee_amount
renewal_type TEXT -- city_sticker, license_plate, both
renewal_due_date
customer_notified BOOLEAN, notification_sent_at
attempted_at, succeeded_at, failed_at
created_at, updated_at
```

#### `payment_failure_notifications`
Failed payment notification tracking:
```sql
id UUID PK
user_id UUID
renewal_charge_id UUID
notification_type TEXT -- email, sms
recipient TEXT
status TEXT -- pending, sent, failed, bounced
subject, message
provider TEXT, provider_message_id
sent_at, delivered_at, failed_at, failure_reason
retry_count, max_retries, next_retry_at
created_at, updated_at
```

### Permit Zone Tables

#### `permit_zone_documents`
User-uploaded residency proof documents:
```sql
id UUID PK
user_id UUID
document_type TEXT -- utility_bill, lease, property_tax, drivers_license
document_url TEXT
verification_status TEXT -- pending, approved, rejected
rejected_at, rejected_reason
customer_code TEXT -- City of Chicago assigned code for permit zone
created_at, updated_at
```

#### `parking_permit_zones`
Permit zone geographic data:
```sql
id UUID PK
zone_number INTEGER
zone_name TEXT
description TEXT
geom geometry(POLYGON, 4326) -- PostGIS geometry for spatial queries
created_at
```

### Notification & Audit Tables

#### `message_audit_log`
Comprehensive message delivery tracking:
```sql
id UUID PK
user_id UUID
user_email TEXT
user_phone TEXT
message_key TEXT -- e.g., renewal_city_sticker_30day
message_channel TEXT -- email, sms, voice, push
message_preview TEXT
external_message_id TEXT -- from Resend/ClickSend/FCM
context_data JSONB -- {plate, zone, days_until, renewal_type, has_protection}
status TEXT -- pending, sent, skipped, failed
skip_reason TEXT -- already_sent_48h, user_disabled_sms, missing_phone_number
error_details JSONB
cost_cents INTEGER
sent_at, created_at
```

#### `notification_logs`
General notification events:
```sql
id UUID PK
user_id UUID
event_type TEXT
recipient TEXT
status TEXT
provider TEXT
sent_at, created_at
```

### Analytics & Reporting Tables

#### `protection_interest_survey`
User responses to protection service interest:
```sql
id UUID PK
user_id UUID
interested BOOLEAN
monthly_cost_acceptable DECIMAL
notification_frequency TEXT
created_at
```

#### `drip_campaign_entries`
User enrollment in email drip campaigns:
```sql
user_id UUID
campaign_key TEXT
enrolled_at
completed_at
```

---

## 2. TICKET CONTESTING FEATURE FLOW

### Architecture Overview
```
User Upload Ticket Photo
    ↓
Claude Vision OCR Extraction
    ↓
Create ticket_contests record (draft)
    ↓
User Reviews/Edits Extracted Data
    ↓
User Selects Contest Grounds
    ↓
Claude Generates AI Contest Letter
    ↓
Letter Integrated with Evidence (if uploaded)
    ↓
Admin Reviews Letter (ticket-pipeline admin endpoint)
    ↓
Generate Mail Payment (if self-filing)
    ↓
Lob.com Mails Letter to City
    ↓
Tracking Updates (lob_status, mailed_at)
    ↓
User Reports Outcome
    ↓
Update court_case_outcomes table
    ↓
Recalculate win_rate_statistics for violation code
```

### API Endpoints

**POST `/api/contest/upload-ticket`**
- File upload + base64 image data
- Claude Vision extracts ticket details
- Creates `ticket_contests` record in draft status
- Returns contest ID + extracted data

**POST `/api/contest/upload-evidence`**
- Multipart form with evidence files
- Stores in Supabase storage
- Updates `ticket_contests.evidence_photos` or `supporting_documents`
- Supports: sign_photo, location_photo, ticket_photo, permit, receipt, other_document

**POST `/api/contest/upload-video`**
- Video evidence upload
- Similar to upload-evidence but for video files

**POST `/api/contest/generate-letter`**
- Input: contest ID, contest grounds, additional context
- Fetches court data for violation code to improve letter quality
- Claude generates tailored contest letter
- Uses win_rate_statistics to reference successful arguments
- Creates/updates `contest_letters` record
- Returns letter HTML

**POST `/api/contest/create-mail-payment`**
- Creates Stripe payment intent for mail filing service ($X fee)
- Returns payment client secret for frontend

**POST `/api/contest/report-outcome`**
- User reports final court outcome
- Inserts into `court_case_outcomes` table
- Recalculates `win_rate_statistics` for that violation code
- Updates `ticket_contests` status

**GET `/api/contest/win-probability`**
- Returns win rate for a specific violation code
- Also returns successful contest grounds and evidence guidance

**GET `/api/contest/list`**
- Returns all contests for authenticated user
- Filters by status, date range

### Admin Ticket Pipeline
**GET `/api/admin/ticket-pipeline`**
- Returns tickets in various stages:
  1. Ticket Detected (uploaded, OCR done)
  2. Letter Generated (without evidence)
  3. Evidence Letter Generated (evidence integrated)
  4. Letter Sent to City (mailed via Lob)
- Returns pipeline metrics
- Admins can preview letters, mark for mail sending

---

## 3. ATTORNEY PARTNERSHIP SYSTEM

### Workflow
```
1. Attorney Registration
   → Verify bar number
   → Set specializations and pricing
   → Add to attorneys table

2. User Requests Quote
   → Selects attorney from marketplace
   → Submits attorney_quote_requests
   → Attorney gets notification (webhook)

3. Attorney Reviews & Quotes
   → Marks request as attorney_viewed
   → Provides quote_amount + quote_details
   → User has 24h to accept/decline

4. If Accepted
   → Legal engagement begins
   → Attorney works case using contest_letter as starting point

5. Case Resolution
   → User reports outcome
   → Court record created
   → Attorney reviews stay updated via public attorney_reviews
```

### Key Endpoints
- `GET /api/attorneys` - List active attorneys with filters
- `POST /api/attorneys/quote-request` - Submit quote request
- `GET /api/attorneys/quote-requests` - View attorney quotes
- `POST /api/contest/request-attorney` - Request attorney for contest

---

## 4. CITY STICKER & LICENSE PLATE RENEWAL

### Subscription Model (Protection)
```
User signs up for Protection subscription
    ↓
Stripe subscription created (monthly or annual)
    ↓
stripe_subscription_id stored in user_profiles
    ↓
Cron job runs daily at specific times
    ↓
For users within 30 days of renewal:
    - Create renewal_charges record (pending)
    - Send Stripe charge request
    - If successful: city_sticker_purchase_confirmed_at set
    - If failed: payment_failure_notifications created
    ↓
Notifications sent (SMS/Email/Voice/Push)
    - 60 days before renewal (Protection users)
    - 45 days before renewal
    - 37 days before (1 week before 30-day auto-charge)
    - 30 days before (charge day notification)
    - 14, 7, 1 days before (for free users without protection)
```

### Partner Integration (Renewal Orders)
```
Customer submits renewal order at partner location or online
    ↓
Documents uploaded (driver's license, proof of residence)
    ↓
Auto-verification via Claude OCR (confidence scoring)
    ↓
Admin manual review if confidence < threshold
    ↓
Payment processed via Stripe Connect:
    - Platform takes commission/fee
    - Partner receives remainder
    ↓
Order marked payment_received
    ↓
Automatically pushed to city portal OR
    Manual processing for non-automated partners
    ↓
Status updates sent to customer
    ↓
Sticker details populated when city confirms
    ↓
Fulfillment (mail or pickup)
    ↓
Tracking updates sent
```

### Renewal API Endpoints
**POST `/api/create-checkout`**
- Creates Stripe checkout session for Protection subscription or renewal charges
- Returns session ID

**POST `/api/renewal-intake/submit-order`**
- Partner: submits renewal order with customer info
- Returns order_number for tracking

**POST `/api/renewal-intake/validate-documents`**
- Auto-verify documents with Claude OCR
- Returns confidence scores and extracted data

**POST `/api/renewal-intake/process-payment`**
- Process payment via Stripe Connect
- Distribute to partner via connected account

**POST `/api/renewal-intake/export-pdf`**
- Partner exports order as PDF

**GET `/api/renewal-intake/partner-dashboard`**
- Partner views their orders, stats, revenue

---

## 5. NOTIFICATION SYSTEM ARCHITECTURE

### Notification Stack
1. **Email**: Resend API
2. **SMS**: ClickSend API
3. **Voice Calls**: ClickSend voice API
4. **Push**: Firebase Cloud Messaging (FCM)

### Notification Service Classes

#### `NotificationService`
One-off notifications sent immediately:
```typescript
sendEmail(notification: EmailNotification)
sendSMS(notification: SMSNotification)
sendVoiceCall(notification: VoiceNotification)
sendPush(notification: PushNotificationRequest)
```

#### `NotificationScheduler`
Batch processing for reminders (runs daily via cron):
```typescript
processPendingReminders() {
  - Fetch all users with renewal dates
  - Batch pre-fetch permit docs (avoid N+1)
  - Batch pre-fetch renewal payments
  - For each user, check if today matches reminder day
  - Send based on notification_preferences
  - Log to message_audit_log
  - Check for 48h deduplication
}
```

### Message Templates
Centralized templates in `lib/message-templates`:
```typescript
sms.renewalFree(context) - For users without protection
sms.renewalProtection(context) - For protection users
email.renewalFree(context)
email.renewalProtection(context)
voice.renewalReminder(renewalType, daysUntil, dueDate)
```

### Message Audit Logging
Every notification attempt is logged to `message_audit_log`:
- User ID, email, phone
- Message key (for deduplication)
- Channel (email/sms/voice/push)
- Status (sent/skipped/failed)
- Skip reason (user disabled, missing phone, already sent)
- Context data (plate, zone, days_until)
- Cost tracking (email ~0¢, SMS ~2¢, voice ~5¢)

### Cron Jobs
Typical renewal notification flow (runs daily):
```
POST /api/cron/notify-renewals
  → NotificationScheduler.processPendingReminders()
  → Sends SMS, email, voice, push based on prefs
  → Logs all attempts to message_audit_log
```

---

## 6. DOCUMENT UPLOAD & STORAGE

### Upload Locations
1. **Ticket Photos**: `supabase://ticket-photos/{user_id}/{timestamp}.jpg`
2. **Evidence Files**: `supabase://contest-evidence/{user_id}/{contest_id}/{filename}`
3. **Video Evidence**: `supabase://contest-videos/{user_id}/{contest_id}/{filename}`
4. **Renewal Documents**: `supabase://renewal-documents/{order_id}/{document_type}/{filename}`
5. **Permit Zone Docs**: `supabase://permit-zone-documents/{user_id}/{filename}`
6. **Property Tax Bills**: `supabase://property-tax/{user_id}/{filename}`

### Upload Endpoints

**POST `/api/contest/upload-ticket`**
- Base64 image
- 10MB limit
- Returns photo URL + extracted data

**POST `/api/contest/upload-evidence`**
- Multipart form data
- 10 files max per upload
- 10MB per file
- Evidence types: sign_photo, location_photo, ticket_photo, permit, receipt, other_document

**POST `/api/contest/upload-video`**
- Multipart form data
- Video file (mp4, mov, etc.)
- Returns video URL

**POST `/api/city-sticker/get-residency-proof`**
- Upload residency document
- Returns upload confirmation

**POST `/api/renewal-intake/validate-documents`**
- Renewal order documents
- Claude OCR verification
- Confidence scoring

### Security
- Rate limiting: 20 uploads per hour per IP
- RLS policies restrict access to own documents
- File size limits enforced
- MIME type validation
- Base64 data validation

---

## 7. SUBSCRIPTION & PAYMENT MODEL

### Subscription Tiers (Protection)
```
Monthly: $9.99/month
Annual: $99.99/year (save $20)

Includes:
- Auto city sticker renewal (60-day pre-notification cycle)
- Auto license plate renewal
- Permit zone document coordination
- Ticket contesting assistance
- Notifications via SMS/Email/Voice/Push
```

### Stripe Integration
- `stripe_customer_id`: Links user to Stripe customer
- `stripe_subscription_id`: Active subscription ID
- `subscription_status`: active, past_due, canceled, trialing, unpaid
- `subscription_started_at`, `subscription_canceled_at`: Timestamps

### Auto-Renewal Payment Flow (via Cron)
```
Daily Cron Job:
  1. Find users with has_protection = true
  2. Filter by city_sticker_expiry <= 30 days OR license_plate_expiry <= 30 days
  3. Create renewal_charges record (pending)
  4. Call Stripe to charge subscription customer
  5. If succeeded:
     - Update renewal_charges.status = succeeded
     - Set city_sticker_purchase_confirmed_at
     - Send success notification
  6. If failed:
     - Update renewal_charges.status = failed
     - Create payment_failure_notification
     - Retry next day (max 3 retries)
```

### Remitter Payments (Stripe Connect)
```
Customer pays via renewal order
    ↓
Stripe creates payment intent
    ↓
Platform receives full amount
    ↓
Stripe transfer created to remitter's connected account
    ↓
Remitter receives commission_percentage or service_fee_amount
    ↓
Platform keeps remainder
```

### Checkout Flow
**POST `/api/create-checkout`**
- Input: `type` (subscription, renewal_order, license_plate)
- Creates Stripe session
- Returns client secret or checkout URL

---

## 8. EXISTING PROPERTY-RELATED FEATURES

### Current Property Tax Functionality
The system already has MINIMAL property tax features for residency proof in permit zones:

**Property Tax Admin Queue** (`/api/admin/property-tax-queue`)
- Shows permit zone users needing residency documents
- Admin can attempt to fetch property tax bill from Cook County
- Stores: `property_tax_last_fetched_at`, `property_tax_needs_refresh`, `property_tax_fetch_failed`, `property_tax_fetch_notes`

**Property Tax Helper Component**
- UI for admins to manage property tax lookups
- Shows queue of users needing refresh (July cron job)
- Limited to homeowners only (renters need utility bills)

**Columns in user_profiles**
```
residency_proof_type TEXT -- NULL, property_tax, utility_bill, lease
property_tax_last_fetched_at TIMESTAMPTZ
property_tax_needs_refresh BOOLEAN
property_tax_fetch_failed BOOLEAN
property_tax_fetch_notes TEXT
```

### Usage
- Only used for permit zone city sticker renewals
- Admin manually fetches when user provides home address
- Acts as proof of residency

### NOT CURRENTLY IMPLEMENTED
- Property tax assessment appeals
- Property tax payment tracking
- Property tax bill viewing/downloading
- Multi-year property tax history
- Comparison with neighboring properties
- Property tax due date monitoring
- Appeals process automation
- Correspondence/letter generation for appeals
- Integration with Cook County portal for appeals

---

## 9. ADMIN PORTAL

### Key Admin Features

**Ticket Contesting**
- `/api/admin/ticket-pipeline` - View tickets in various stages
- `/api/admin/contest-letters` - Preview/approve letters before mailing
- Manual letter sending via Lob
- Review user reports of outcomes

**Renewals Management**
- `/api/admin/renewals` - Upcoming renewals, batch send reminders
- `/api/admin/upcoming-renewals` - Dashboard of users needing notifications
- `/api/admin/send-sticker-notifications` - Manual trigger for renewal SMS/email

**Permit Zone Documents**
- `/api/admin/permit-documents` - Review uploaded documents
- `/api/admin/review-permit-document` - Manual verification, approval/rejection
- Property tax queue for homeowners

**Partner Management**
- `/api/admin/partners` - CRUD for renewal partners
- `/api/admin/remitter-orders` - View partner orders, status
- `/api/admin/partner-inquiries` - Lead inquiries from partners
- `/api/admin/transfer-requests` - Handle payment transfers to partners

**Monitoring**
- `/api/admin/monitoring` - System health status, API metrics
- `/api/admin/webhook-health-status` - Stripe/Lob webhook status
- Test harness endpoints for debugging

---

## 10. MOBILE APP STRUCTURE

### React Native (Expo) Mobile App
Located in: `TicketlessChicagoMobile/`

**Architecture:**
- Expo framework (iOS/Android build)
- React Native + TypeScript
- Redux/Context for state management
- Firebase for push notifications
- API calls to web backend

**Key Screens:**
- Authentication (login/signup)
- Dashboard (upcoming renewals, parking info)
- Ticket upload (camera capture)
- Contest flow
- Renewal status tracking
- Push notifications

**Native Modules:**
- Android: Google Play Services for location
- iOS: Apple Maps integration

---

## 11. KEY LIBRARIES & UTILITIES

### Core
- `lib/supabase.ts` - Supabase client setup
- `lib/notifications.ts` - Notification service classes
- `lib/message-audit-logger.ts` - Audit logging
- `lib/stripe-config.ts` - Stripe test/live mode switching

### Integrations
- `lib/lob-service.ts` - Physical mail via Lob
- `lib/push-service.ts` - Firebase Cloud Messaging
- `lib/sms-service.ts` - ClickSend SMS/voice
- `lib/weather-service.ts` - Weather API integration
- `lib/unified-parking-checker.ts` - Multi-city parking logic

### Utilities
- `lib/chicago-ordinances.ts` - Violation code database
- `lib/address-parser.ts` - Address normalization
- `lib/mask-pii.ts` - Data masking for logs
- `lib/rate-limiter.ts` - IP-based rate limiting
- `lib/audit-logger.ts` - General audit logging

### City-Specific
- `lib/chicago-timezone-utils.ts` - Chicago time handling
- `lib/winter-ban-notifications.ts` - Winter overnight parking
- `lib/sf-street-sweeping.ts` - San Francisco street cleaning
- `lib/boston-street-sweeping.ts` - Boston street cleaning
- `lib/la-street-sweeping.ts` - Los Angeles street sweeping

---

## 12. KEY DESIGN PATTERNS

### Rate Limiting
IP-based rate limiting for uploads and API calls:
```typescript
checkRateLimit(clientIp, action: 'upload' | 'api')
recordRateLimitAction(clientIp, action)
```

### RLS (Row Level Security)
All tables have RLS enabled:
- Users can only see/modify their own data
- Service role for admin/cron jobs
- Anonymous access for public endpoints (e.g., attorney listings)

### Deduplication
Message audit log tracks duplicate sends:
- `checkRecentlySent(userId, messageKey, hours)` - Check if sent in last N hours
- Prevents spam from rapid cron runs or user actions

### Materialized Views
`win_rate_statistics` - Pre-calculated win probabilities for performance
Updated via triggers when `court_case_outcomes` changes

### Soft Deletes
N/A - Uses CASCADE on deletes, explicit status fields (e.g., `status: 'cancelled'`)

### Enums
Uses TEXT CHECK constraints instead of true enums:
```sql
status TEXT CHECK (status IN ('draft', 'pending_review', 'submitted'))
```

---

## 13. DEPLOYMENT & OPERATIONS

### Environment Configuration
- `.env.local` - Development secrets
- `.env.production` - Production secrets
- Stripe mode switching: `STRIPE_MODE=test` or `STRIPE_MODE=live`

### Cron Jobs
Run via external cron service (e.g., cron-job.org, GitHub Actions):
- `POST /api/cron/notify-renewals` - Daily renewal reminders
- `POST /api/cron/send-sticker-notifications` - Winter ban alerts
- Various admin tasks

### Database Backups
Supabase handles automatic backups (daily/weekly/monthly retention)

### Monitoring
- Health checks: `GET /api/health`
- Admin monitoring dashboard: `/api/admin/monitoring`
- Webhook health: `/api/admin/webhook-health-status`

---

## SUMMARY TABLE

| Feature | Table(s) | API Endpoint(s) | Status |
|---------|----------|----------------|--------|
| Parking Ticket Contesting | ticket_contests, court_case_outcomes, win_rate_statistics, attorneys, attorney_reviews, attorney_quote_requests | /api/contest/*, /api/attorneys/* | Live |
| City Sticker Renewal | renewal_orders, renewal_partners, renewal_documents, renewal_charges | /api/renewal-intake/*, /api/create-checkout | Live |
| License Plate Renewal | user_profiles (renewal fields) | /api/create-checkout | Live |
| Permit Zone Management | permit_zone_documents, parking_permit_zones, user_profiles | /api/check-permit-zone, /api/admin/permit-documents | Live |
| Property Tax Lookup | user_profiles (property_tax_* fields) | /api/admin/property-tax-queue, /api/admin/upload-property-tax | Minimal (residency only) |
| Notifications | message_audit_log, notification_logs, user_profiles | /api/cron/notify-renewals | Live |
| Push Notifications | push_tokens (implicit) | /api/notifications/subscribe | Live |
| Stripe Subscriptions | user_profiles (stripe_*), renewal_charges | /api/create-checkout | Live |
| Attorney Partnerships | attorneys, attorney_reviews, attorney_quote_requests | /api/attorneys/*, /api/contest/request-attorney | Live |
| Winter Parking Bans | snow_routes, snow_route_status | /api/get-snow-routes, /api/cron/send-sticker-notifications | Live |
| Multi-City Support | Various tables with city/state fields | City-specific endpoints (boston-*, sf-*, la-*) | Live |

---

## NEXT STEPS FOR PROPERTY TAX FEATURE

To design the property tax appeal feature, you'll want to:

1. **Data Model** - Add tables for:
   - property_tax_appeals (appeals, status, timeline)
   - property_tax_history (multi-year assessment history)
   - appeal_documents (comparables, photos, etc.)
   - appeal_correspondence (letters, responses from assessor)

2. **API Endpoints** - Create:
   - POST /api/property-tax/start-appeal
   - POST /api/property-tax/upload-comparable
   - GET /api/property-tax/assessment-history
   - POST /api/property-tax/generate-appeal-letter
   - GET /api/admin/property-tax-appeals (admin queue)

3. **Integration Points** - Connect to:
   - Claude for letter generation
   - Property tax data sources (Cook County API)
   - Existing notification system
   - Admin portal

4. **Notification Flow** - Add:
   - Appeal status updates
   - Deadline reminders
   - Assessment comparisons
   - Appeal hearing notifications

See the architecture files for implementation patterns.

