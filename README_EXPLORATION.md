# Ticketless Chicago - Codebase Exploration Index

## Overview
This directory contains comprehensive documentation of the Ticketless Chicago codebase architecture, including all core features, database schema, API endpoints, and integration patterns.

## Documentation Files

### 1. **ARCHITECTURE_OVERVIEW.md** (969 lines)
Complete technical specification of the entire platform including:
- Database schema for all 20+ tables
- Ticket contesting complete flow with API endpoints
- Attorney partnership system
- Notification system architecture (multi-channel)
- Document upload/storage patterns
- Subscription & payment model (Stripe)
- City sticker & license plate renewal system
- Permit zone features
- Admin portal structure
- Mobile app (React Native)
- Key libraries and design patterns

**When to read:** Need complete system understanding or architectural reference

### 2. **EXPLORATION_RESULTS.md** (550 lines)
Summary of key findings organized by feature:
- Database schema overview with file references
- Ticket contesting feature with complete flow
- Attorney partnerships workflow
- Notification system details
- Document upload patterns
- Subscription & payment models
- Renewal & partner integration
- Permit zone features
- Existing property tax features (minimal)
- Admin portal breakdown
- Mobile app structure
- Tech stack summary

**When to read:** Quick reference to understand specific features or implementation files

### 3. **This File (README_EXPLORATION.md)**
Index and navigation guide for all exploration documentation

---

## Quick Navigation by Topic

### Database & Schema
- **Location:** `/database/migrations/` (40+ migration files)
- **Overview:** EXPLORATION_RESULTS.md § "1. DATABASE SCHEMA"
- **Details:** ARCHITECTURE_OVERVIEW.md § "1. DATABASE SCHEMA ARCHITECTURE"
- **Key Files:**
  - `create_ticket_contests.sql` - Ticket contesting schema
  - `create_court_records_and_attorneys.sql` - Court data & attorney marketplace
  - `create_renewal_intake_system.sql` - City sticker renewal (285 lines)
  - `add_subscription_and_payment_fields.sql` - Stripe integration

### Parking Ticket Contesting
- **Location:** `/pages/api/contest/`, `/pages/api/admin/ticket-*.ts`
- **Overview:** EXPLORATION_RESULTS.md § "2. TICKET CONTESTING FEATURE"
- **Details:** ARCHITECTURE_OVERVIEW.md § "2. TICKET CONTESTING FEATURE FLOW"
- **Flow:** Upload → OCR → Generate Letter → Admin Review → Mail → Report Outcome
- **Key Endpoints:**
  - `POST /api/contest/upload-ticket` - Claude Vision OCR
  - `POST /api/contest/generate-letter` - AI letter generation
  - `POST /api/contest/report-outcome` - Outcome reporting
  - `GET /api/admin/ticket-pipeline` - Admin pipeline view

### Attorney Partnerships
- **Location:** `/database/migrations/create_court_records_and_attorneys.sql`, `/pages/api/attorneys/`
- **Overview:** EXPLORATION_RESULTS.md § "3. ATTORNEY PARTNERSHIPS"
- **Details:** ARCHITECTURE_OVERVIEW.md § "3. ATTORNEY PARTNERSHIP SYSTEM"
- **Tables:** `attorneys`, `attorney_reviews`, `attorney_quote_requests`, `attorney_case_expertise`
- **Key Endpoints:**
  - `GET /api/attorneys` - Attorney marketplace
  - `POST /api/attorneys/quote-request` - Request quote
  - `GET /api/attorneys/quote-requests` - View quotes

### Notifications System
- **Location:** `/lib/notifications.ts` (800+ lines), `/lib/message-audit-logger.ts`
- **Overview:** EXPLORATION_RESULTS.md § "4. NOTIFICATION SYSTEM"
- **Details:** ARCHITECTURE_OVERVIEW.md § "5. NOTIFICATION SYSTEM ARCHITECTURE"
- **Features:** Email (Resend), SMS (ClickSend), Voice (ClickSend), Push (FCM)
- **Key Classes:**
  - `NotificationService` - One-off notifications
  - `NotificationScheduler` - Batch processing (daily cron)
- **Audit:** Every notification logged to `message_audit_log` table
- **Deduplication:** 48-hour window to prevent spam

### Document Uploads
- **Location:** `/pages/api/contest/upload-*.ts`, `/pages/api/renewal-intake/validate-documents.ts`
- **Overview:** EXPLORATION_RESULTS.md § "5. DOCUMENT UPLOAD & STORAGE"
- **Details:** ARCHITECTURE_OVERVIEW.md § "6. DOCUMENT UPLOAD & STORAGE"
- **Buckets:** ticket-photos, contest-evidence, contest-videos, renewal-documents, permit-zone-documents
- **Security:** Rate limiting (20/hour), RLS policies, file size limits, MIME validation

### City Sticker & License Plate Renewal
- **Location:** `/pages/api/renewal-intake/`, `/database/migrations/create_renewal_intake_system.sql`
- **Overview:** EXPLORATION_RESULTS.md § "6. SUBSCRIPTION & PAYMENT MODEL", § "7. RENEWAL & PARTNER INTEGRATION"
- **Details:** ARCHITECTURE_OVERVIEW.md § "4. CITY STICKER & LICENSE PLATE RENEWAL", § "7. SUBSCRIPTION & PAYMENT MODEL"
- **Tables:** `renewal_orders`, `renewal_partners`, `renewal_charges`, `renewal_documents`
- **Features:**
  - Protection subscription ($9.99/month or $99.99/year)
  - Auto-renewal via Stripe
  - Partner integration (remitters, dealerships)
  - Stripe Connect for partner payouts

### Permit Zones & Residency Proof
- **Location:** `/pages/api/check-permit-zone`, `/pages/api/admin/permit-documents.ts`, `/pages/api/admin/review-permit-document.ts`
- **Overview:** EXPLORATION_RESULTS.md § "8. PERMIT ZONE FEATURES"
- **Details:** ARCHITECTURE_OVERVIEW.md § "1. DATABASE SCHEMA ARCHITECTURE" (permit_zone_documents table)
- **Tables:** `permit_zone_documents`, `parking_permit_zones`
- **Features:** Document upload, verification workflow, email forwarding for utility bills

### Property Tax (Minimal - Residency Only)
- **Location:** `/pages/api/admin/property-tax-queue.ts`, `/components/PropertyTaxHelper.tsx`
- **Overview:** EXPLORATION_RESULTS.md § "9. EXISTING PROPERTY TAX FEATURES (Minimal)"
- **Details:** ARCHITECTURE_OVERVIEW.md § "8. EXISTING PROPERTY-RELATED FEATURES"
- **Current Use:** Residency proof for permit zones (homeowners only)
- **NOT Implemented:** Appeals, multi-year history, payment tracking, comparables, due dates
- **Note:** This is where the new property tax appeal feature would integrate

### Admin Portal
- **Location:** `/pages/api/admin/` (45+ files)
- **Overview:** EXPLORATION_RESULTS.md § "10. ADMIN PORTAL"
- **Details:** ARCHITECTURE_OVERVIEW.md § "9. ADMIN PORTAL"
- **Features:**
  - Ticket pipeline management
  - Renewal oversight
  - Document verification
  - Partner management
  - Payment transfers
  - System monitoring

### Mobile App
- **Location:** `/TicketlessChicagoMobile/`
- **Overview:** EXPLORATION_RESULTS.md § "11. MOBILE APP"
- **Details:** ARCHITECTURE_OVERVIEW.md § "10. MOBILE APP STRUCTURE"
- **Stack:** Expo/React Native with TypeScript
- **Key Screens:** Auth, Dashboard, Ticket upload, Contest flow, Renewal status

### Payment & Stripe Integration
- **Location:** `/lib/stripe-config.ts`, `/pages/api/create-checkout.ts`
- **Overview:** EXPLORATION_RESULTS.md § "6. SUBSCRIPTION & PAYMENT MODEL"
- **Details:** ARCHITECTURE_OVERVIEW.md § "7. SUBSCRIPTION & PAYMENT MODEL"
- **Features:**
  - Test/live mode switching
  - Subscription billing (monthly/annual)
  - One-time charges (renewals, contests)
  - Stripe Connect for partner payouts

---

## Implementation Patterns to Reuse

For the property tax appeal feature, these patterns are directly applicable:

### Pattern 1: Document Upload + OCR
**Example:** `/pages/api/contest/upload-ticket.ts` + `/pages/api/contest/upload-evidence.ts`
**How:** Base64 upload → Claude Vision OCR → Store in Supabase → Extract data to JSON
**Can be used for:** Property assessment documents, comparable property photos

### Pattern 2: AI Letter Generation
**Example:** `/pages/api/contest/generate-letter.ts`
**How:** 
1. Fetch historical context (court data for tickets → assessment history for property tax)
2. Call Claude with context + user-provided info
3. Generate HTML letter
4. Mail via Lob
**Can be used for:** Appeal letter generation

### Pattern 3: Admin Queue Management
**Example:** `/pages/api/admin/permit-documents.ts`, `/pages/api/admin/property-tax-queue.ts`
**How:**
1. Query users with specific conditions (status = pending)
2. Add computed fields (days_until_deadline, urgency, status)
3. Filter/sort by admin preferences
4. Batch review interface
**Can be used for:** Appeal deadline queue, assessment comparison review

### Pattern 4: Notification Scheduling
**Example:** `NotificationScheduler.processPendingReminders()`
**How:**
1. Batch fetch all users needing notifications
2. Pre-fetch related data (avoid N+1 queries)
3. Check conditions (date match, preferences)
4. Send multi-channel notifications (email/SMS/voice/push)
5. Log to audit table
**Can be used for:** Appeal deadline reminders, hearing date notifications

### Pattern 5: Stripe Integration
**Example:** `renewal_charges` table + `/api/create-checkout.ts`
**How:**
1. Create charge record (pending)
2. Call Stripe checkout/charge API
3. Update record (succeeded/failed)
4. Notify user
**Can be used for:** Optional paid appeal assistance service

### Pattern 6: Status Tracking & Workflows
**Example:** `renewal_orders` table with activity log
**How:**
1. Main table with status field (enum via CHECK constraint)
2. Separate activity_log table tracking state changes
3. Computed fields (stage, urgency)
4. Timestamp tracking (created_at, updated_at, milestone dates)
**Can be used for:** Appeal progress tracking, hearing status updates

### Pattern 7: Audit Logging
**Example:** `message_audit_log` + `renewal_order_activity_log`
**How:** Log every significant action with user, timestamp, old/new values, metadata
**Can be used for:** Appeals audit trail, correspondence logging

---

## Key Files by Category

### Core Infrastructure
- `/lib/supabase.ts` - Supabase client
- `/lib/stripe-config.ts` - Stripe configuration
- `/lib/notifications.ts` - Notification services (800 lines)
- `/lib/audit-logger.ts` - General audit logging
- `/lib/message-audit-logger.ts` - Message audit logging

### Authentication & Authorization
- `/lib/auth-middleware.ts` - Admin/user auth checks
- `/pages/api/auth/` - Auth endpoints

### API Patterns
- `rate-limiter.ts` - IP-based rate limiting
- `error-utils.ts` - Error sanitization
- `webhook-verification.ts` - Webhook validation

### City Integration
- `lib/chicago-ordinances.ts` - Violation codes database
- `lib/address-parser.ts` - Address normalization
- `lib/chicago-timezone-utils.ts` - Chicago time handling

### Multi-City Support
- `lib/sf-street-sweeping.ts` - San Francisco
- `lib/boston-street-sweeping.ts` - Boston
- `lib/la-street-sweeping.ts` - Los Angeles

### External Services
- `lib/lob-service.ts` - Physical mail (Lob.com)
- `lib/sms-service.ts` - SMS/voice (ClickSend)
- `lib/push-service.ts` - Push notifications (FCM)
- `lib/weather-service.ts` - Weather API

---

## Database Design Principles Used

1. **UUID Primary Keys** - `id UUID DEFAULT gen_random_uuid() PRIMARY KEY`
2. **Timestamps** - `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at` with trigger
3. **Foreign Keys** - Explicit references with ON DELETE CASCADE/SET NULL
4. **RLS (Row Level Security)** - All user-data tables have policies
5. **Indexes** - Composite indexes for common queries, GIN for arrays/JSONB
6. **CHECK Constraints** - For enums instead of true PostgreSQL enums
7. **JSONB Columns** - For flexible, schemaless data (extracted_data, evidence_checklist, etc.)
8. **Materialized Views** - `win_rate_statistics` for performance
9. **Audit Logging** - Separate activity log tables
10. **Status Tracking** - Explicit state machines via CHECK constraints

---

## How to Use This Documentation

1. **First Time?** → Read EXPLORATION_RESULTS.md for quick overview
2. **Need Details?** → Reference specific section in ARCHITECTURE_OVERVIEW.md
3. **Designing a Feature?** → Look at "Implementation Patterns to Reuse" section above
4. **Finding a File?** → Use "Quick Navigation by Topic" or "Key Files by Category"
5. **Understanding a Flow?** → Search for "Workflow" or "Flow" in ARCHITECTURE_OVERVIEW.md

---

## Ready to Design Property Tax Appeals

With this documentation, you have complete understanding of:
- Database patterns (can model appeals, assessment history, comparables)
- Notification system (can alert on deadlines, hearing dates)
- Document workflows (can handle appeal documents, comparables)
- AI integration (can generate appeal letters)
- Admin portal patterns (can build appeals queue)
- Payment processing (can charge for optional services)
- Multi-channel communication (SMS/email/voice reminders)
- Audit trails (can track full appeal process)

See EXPLORATION_RESULTS.md "Ready for Property Tax Feature Design" section for next steps.

---

Last Updated: 2025-01-05
Exploration Scope: Complete codebase analysis
Documentation Quality: Comprehensive with file references and code samples
