# Ticketless Chicago Codebase Exploration - Results Summary

## Documents Generated
1. **ARCHITECTURE_OVERVIEW.md** - Comprehensive 969-line architecture document covering all systems

## Key Findings

### 1. DATABASE SCHEMA
The database uses Supabase/PostgreSQL with extensive RLS policies.

**Core Tables:**
- `auth.users` - Supabase authentication
- `user_profiles` - Central user data with 50+ fields
- `ticket_contests` - Parking ticket contesting submissions
- `court_case_outcomes` - Historical court data for win probability
- `win_rate_statistics` - Materialized view for ML predictions
- `attorneys` - Attorney marketplace
- `renewal_orders` - City sticker renewal orders
- `renewal_partners` - Partner organizations (remitters, dealerships)
- `renewal_charges` - Payment tracking
- `permit_zone_documents` - Residency proof uploads
- `message_audit_log` - Notification tracking

**Key Schema Files:**
- `/database/migrations/create_ticket_contests.sql` - Ticket contesting
- `/database/migrations/create_court_records_and_attorneys.sql` - Court data & attorneys
- `/database/migrations/create_renewal_intake_system.sql` - Renewal orders (285+ lines)
- `/database/migrations/add_subscription_and_payment_fields.sql` - Stripe integration
- `/database/migrations/add_property_tax_admin_tracking.sql` - Property tax fields (minimal)
- `COMPLETE_MIGRATIONS.sql` - License plate renewal with cost calculation
- `scripts/create-user-profiles-table.sql` - Main user profile table

### 2. TICKET CONTESTING FEATURE

**Complete Flow:**
1. User uploads ticket photo (OCR via Claude Vision)
2. System creates `ticket_contests` record (draft)
3. User uploads evidence (sign photos, location photos, permits, receipts)
4. Claude generates AI-enhanced contest letter
5. Admin reviews via `/api/admin/ticket-pipeline`
6. System mails letter via Lob.com
7. User reports outcome → updates `court_case_outcomes`
8. Win rates recalculated for violation code

**API Endpoints:**
- `POST /api/contest/upload-ticket` - Upload ticket photo with OCR
- `POST /api/contest/upload-evidence` - Upload evidence files (multipart)
- `POST /api/contest/upload-video` - Upload video evidence
- `POST /api/contest/generate-letter` - Generate AI contest letter
- `POST /api/contest/create-mail-payment` - Stripe payment for mailing
- `POST /api/contest/report-outcome` - Report court outcome
- `GET /api/contest/win-probability` - Get win rates for violation code
- `GET /api/contest/list` - List user's contests

**Admin Endpoints:**
- `GET /api/admin/ticket-pipeline` - View tickets in pipeline stages
- `GET /api/admin/contest-letters` - Review letters before mailing

**Key Implementation Files:**
- `/pages/api/contest/upload-ticket.ts` - Claude Vision OCR integration
- `/pages/api/contest/generate-letter.ts` - AI letter generation with court data
- `/pages/api/contest/report-outcome.ts` - Outcome reporting & win rate recalculation
- `/pages/api/admin/ticket-pipeline.ts` - Admin pipeline view
- `/lib/lob-service.ts` - Physical mail service integration (100+ lines)

### 3. ATTORNEY PARTNERSHIPS

**Tables:**
- `attorneys` - Attorney profiles with bar info, specializations, ratings, pricing
- `attorney_case_expertise` - Specialization tracking by violation code
- `attorney_reviews` - User reviews with multi-level ratings
- `attorney_quote_requests` - Quote request workflow

**Quote Request Workflow:**
1. User requests quote from attorney
2. Attorney views request (`attorney_viewed_at`)
3. Attorney provides quote + quote_expires_at
4. User accepts/declines within 24 hours
5. Payment handled via Stripe

**Key Endpoints:**
- `GET /api/attorneys` - List active attorneys with search/filter
- `POST /api/attorneys/quote-request` - Submit quote request
- `GET /api/attorneys/quote-requests` - View attorney quotes
- `POST /api/contest/request-attorney` - Request attorney for specific contest

### 4. NOTIFICATION SYSTEM

**Multi-Channel Architecture:**
- Email: Resend API
- SMS: ClickSend API  
- Voice: ClickSend voice API
- Push: Firebase Cloud Messaging

**Key Classes:**

`NotificationService` (immediate, one-off):
- `sendEmail()`
- `sendSMS()`
- `sendVoiceCall()`
- `sendPush()`

`NotificationScheduler` (batch, daily cron):
- `processPendingReminders()` - Main cron job
- Batch pre-fetches to avoid N+1 queries
- 48-hour deduplication check
- Comprehensive audit logging

**Message Audit Logging:**
- Every notification attempt logged to `message_audit_log`
- Tracks: user, channel, status, skip reason, context, cost
- Supports deduplication (48h window)
- Cost tracking (email ~0¢, SMS ~2¢, voice ~5¢)

**Renewal Notification Timeline:**
- 60 days before: Protection users (confirm info)
- 45 days before: Update reminders
- 37 days before: "Charge coming in 1 week" warning
- 30 days before: Actual charge day notification
- 14, 7, 1 days before: Free users reminders

**Key Implementation Files:**
- `/lib/notifications.ts` - NotificationService & NotificationScheduler (800+ lines)
- `/lib/message-audit-logger.ts` - Audit logging implementation
- `/lib/message-templates.ts` - Centralized message templates
- `/lib/push-service.ts` - Firebase Cloud Messaging
- `/pages/api/cron/notify-renewals` - Daily cron job

### 5. DOCUMENT UPLOAD & STORAGE

**Storage Buckets:**
- `ticket-photos/{user_id}/{timestamp}.jpg` - Ticket uploads
- `contest-evidence/{user_id}/{contest_id}/{filename}` - Evidence files
- `contest-videos/{user_id}/{contest_id}/{filename}` - Video evidence
- `renewal-documents/{order_id}/{document_type}/{filename}` - Renewal docs
- `permit-zone-documents/{user_id}/{filename}` - Residency proof
- `property-tax/{user_id}/{filename}` - Property tax bills

**Upload Endpoints:**
- `POST /api/contest/upload-ticket` - Base64 image, 10MB limit
- `POST /api/contest/upload-evidence` - Multipart, 10 files, 10MB each, 6 types
- `POST /api/contest/upload-video` - Video files
- `POST /api/city-sticker/get-residency-proof` - Residency documents
- `POST /api/renewal-intake/validate-documents` - Document verification with OCR

**Security:**
- Rate limiting: 20 uploads/hour per IP
- RLS policies: Users can only access own documents
- File size limits enforced
- MIME type validation
- Base64 validation

**Key Implementation Files:**
- `/pages/api/contest/upload-ticket.ts` - Base64 upload + Claude OCR
- `/pages/api/contest/upload-evidence.ts` - Multipart form handling (100+ lines)
- `/pages/api/contest/upload-video.ts` - Video upload with streaming

### 6. SUBSCRIPTION & PAYMENT MODEL

**Protection Subscription Tiers:**
- Monthly: $9.99/month
- Annual: $99.99/year (save $20)

**Included Services:**
- Auto city sticker renewal (30-day charge)
- Auto license plate renewal
- Permit zone document coordination
- Ticket contesting assistance
- Multi-channel notifications (SMS/email/voice/push)

**Stripe Integration:**
- `stripe_customer_id` - Link to Stripe customer
- `stripe_subscription_id` - Active subscription
- `subscription_status` - active, past_due, canceled, trialing, unpaid
- `subscription_started_at`, `subscription_canceled_at` - Timestamps

**Auto-Renewal Payment Flow:**
1. Daily cron checks users with `has_protection = true`
2. For users within 30 days of renewal expiry
3. Create `renewal_charges` record (pending)
4. Call Stripe to charge
5. If successful: set `city_sticker_purchase_confirmed_at`
6. If failed: create `payment_failure_notification` (max 3 retries)

**Partner Payments (Stripe Connect):**
1. Customer pays via renewal order
2. Platform receives full amount
3. Stripe transfer to partner's connected account
4. Partner receives commission_percentage or service_fee
5. Platform keeps remainder

**Key Implementation Files:**
- `/lib/stripe-config.ts` - Test/live mode switching (86 lines)
- `/pages/api/create-checkout.ts` - Stripe checkout creation
- `/pages/api/admin/renewals.ts` - Admin renewal management
- `/pages/api/admin/transfer-requests.ts` - Partner payment transfers

### 7. RENEWAL & PARTNER INTEGRATION

**City Sticker Renewal System:**

Tables:
- `renewal_partners` - Remitters, dealerships, currency exchanges
- `renewal_orders` - Digital orders with status tracking
- `renewal_document_reviews` - Document verification queue
- `renewal_order_activity_log` - Audit trail
- `renewal_partner_stats` - Dashboard stats

**Order Lifecycle:**
```
submit → document_upload → verify_documents → payment_received
→ send_to_city → sticker_ready → completed
```

**Partner Features:**
- Stripe Connected Account integration
- Webhook integration for real-time updates
- Digital intake + manual processing
- Commission/fee configuration
- Dashboard with stats and order management
- CSV export capabilities

**Key Implementation Files:**
- `/database/migrations/create_renewal_intake_system.sql` - Complete schema (270+ lines)
- `/pages/api/renewal-intake/submit-order.ts` - Order submission
- `/pages/api/renewal-intake/validate-documents.ts` - Document verification
- `/pages/api/renewal-intake/partner-dashboard.ts` - Partner dashboard API
- `/pages/api/admin/partners.ts` - Partner management
- `/pages/api/admin/remitter-orders.ts` - Order tracking

### 8. PERMIT ZONE FEATURES

**Tables:**
- `permit_zone_documents` - User-uploaded residency proof
- `parking_permit_zones` - Geographic zone data with PostGIS geometry

**Functionality:**
- Residency proof verification for city sticker renewals
- Email forwarding setup for utility bills
- Document types: utility bill, lease, property tax, driver's license
- Approval/rejection workflow with admin review

**Key Endpoints:**
- `POST /api/check-permit-zone` - Check if address is in permit zone
- `GET /api/admin/permit-documents` - Review queue
- `POST /api/admin/review-permit-document` - Manual verification

### 9. EXISTING PROPERTY TAX FEATURES (Minimal)

**Current Usage:**
- Property tax lookup for residency proof (permit zones only)
- Manual admin fetching from Cook County
- Limited to homeowners (renters use utility bills/leases)

**Database Fields:**
```sql
residency_proof_type TEXT -- NULL, property_tax, utility_bill, lease
property_tax_last_fetched_at TIMESTAMPTZ
property_tax_needs_refresh BOOLEAN
property_tax_fetch_failed BOOLEAN
property_tax_fetch_notes TEXT
```

**Admin Endpoints:**
- `GET /api/admin/property-tax-queue` - Queue of users needing refresh
- `POST /api/admin/upload-property-tax` - Admin upload
- `POST /api/admin/property-tax-status` - Status check

**Key Implementation Files:**
- `/pages/api/admin/property-tax-queue.ts` - Queue view (140 lines)
- `/components/PropertyTaxHelper.tsx` - UI component
- `/database/migrations/add_property_tax_admin_tracking.sql` - Schema additions

**NOT Implemented:**
- Property tax assessment appeals
- Multi-year history
- Payment tracking
- Comparables analysis
- Due date monitoring
- Appeals automation
- Cook County portal integration

### 10. ADMIN PORTAL

**Ticket Contesting:**
- `/api/admin/ticket-pipeline` - Pipeline view
- `/api/admin/contest-letters` - Letter approval
- Manual mail triggering

**Renewals:**
- `/api/admin/renewals` - Upcoming list
- `/api/admin/upcoming-renewals` - Dashboard
- `/api/admin/send-sticker-notifications` - Manual trigger

**Permit Zone:**
- `/api/admin/permit-documents` - Document review
- `/api/admin/review-permit-document` - Verification
- `/api/admin/property-tax-queue` - Property tax queue

**Partners:**
- `/api/admin/partners` - Partner management
- `/api/admin/remitter-orders` - Order tracking
- `/api/admin/partner-inquiries` - Lead management
- `/api/admin/transfer-requests` - Payment transfers

**Monitoring:**
- `/api/admin/monitoring` - System health
- `/api/admin/webhook-health-status` - Webhook status
- `/api/admin/test-harness` - Debug utilities

### 11. MOBILE APP

**Location:** `TicketlessChicagoMobile/` (Expo/React Native)

**Architecture:**
- TypeScript
- Redux/Context state management
- Firebase push notifications
- API calls to web backend

**Key Features:**
- Authentication
- Ticket upload with camera
- Contest workflow
- Renewal status tracking
- Push notification reception

**Platform-Specific:**
- Android: Google Play Services (location)
- iOS: Apple Maps integration

**Build Configuration:**
- EAS builds for iOS/Android
- Environment-based configuration (`.env`, `.env.production`)

## File Organization

### Database Migrations
```
/database/migrations/
  - create_ticket_contests.sql
  - create_court_records_and_attorneys.sql
  - create_renewal_intake_system.sql
  - add_subscription_and_payment_fields.sql
  - add_property_tax_admin_tracking.sql
```

### API Routes
```
/pages/api/
  /contest/
    - upload-ticket.ts
    - upload-evidence.ts
    - upload-video.ts
    - generate-letter.ts
    - create-mail-payment.ts
    - report-outcome.ts
    - win-probability.ts
    - list.ts
  /admin/
    - ticket-pipeline.ts
    - contest-letters.ts
    - renewals.ts
    - upcoming-renewals.ts
    - permit-documents.ts
    - review-permit-document.ts
    - partners.ts
    - remitter-orders.ts
    - property-tax-queue.ts
    - monitoring.ts
  /renewal-intake/
    - submit-order.ts
    - validate-documents.ts
    - process-payment.ts
    - export-pdf.ts
    - partner-dashboard.ts
  /cron/
    - notify-renewals.ts
    - send-sticker-notifications.ts
```

### Key Libraries
```
/lib/
  - notifications.ts (800+ lines - core notification service)
  - message-audit-logger.ts
  - message-templates.ts
  - lob-service.ts (physical mail)
  - push-service.ts (FCM)
  - sms-service.ts (ClickSend)
  - stripe-config.ts
  - supabase.ts
  - chicago-ordinances.ts
  - address-parser.ts
  - rate-limiter.ts
  - audit-logger.ts
```

## Tech Stack Summary

| Component | Technology | Key Files |
|-----------|-----------|-----------|
| Frontend | Next.js + React | /pages/*.tsx, /components/ |
| Backend | Next.js API Routes | /pages/api/ |
| Database | Supabase/PostgreSQL | /database/migrations/ |
| Auth | Supabase Auth | /lib/supabase.ts |
| Payments | Stripe + Stripe Connect | /lib/stripe-config.ts |
| Email | Resend API | /lib/notifications.ts |
| SMS/Voice | ClickSend | /lib/sms-service.ts |
| Push | Firebase Cloud Messaging | /lib/push-service.ts |
| Mail | Lob.com | /lib/lob-service.ts |
| OCR | Claude Vision | /pages/api/contest/upload-ticket.ts |
| AI | Anthropic Claude | /pages/api/contest/generate-letter.ts |
| Mobile | Expo/React Native | /TicketlessChicagoMobile/ |
| Hosting | Vercel (implied) | vercel.json (if exists) |

## Ready for Property Tax Feature Design

This codebase provides excellent patterns for implementing property tax appeal features:

1. **Reuse Patterns:**
   - Document upload flow (like contest evidence)
   - AI letter generation (like contest letters)
   - Notification system (for appeal status updates)
   - Admin queue management (like permit documents)
   - Stripe integration (for potential paid appeals)

2. **Key Integration Points:**
   - `user_profiles` table (add appeal-related fields)
   - Notification system (existing infrastructure)
   - Claude integration (for appeal letters)
   - Admin portal (for queue management)
   - Message audit logging (for appeal communications)

3. **Cook County Integration:**
   - Property tax lookup endpoint (already exists)
   - Assessment history fetching
   - Portal for filing appeals
   - Document requirements validation

4. **Timeline & Deadlines:**
   - Add appeal deadline tracking (like renewal dates)
   - Notification schedule (30, 14, 7, 1 days before)
   - Appeal status updates
   - Hearing date reminders

See ARCHITECTURE_OVERVIEW.md for complete technical details and design patterns.
