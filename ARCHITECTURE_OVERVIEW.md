# Ticketless Chicago - Architecture & System Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                                │
│  Next.js Pages (React) + TypeScript                             │
│  - Dashboard, Tickets, Analytics, Admin                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌──────────────────┐  ┌──────────────────┐
│  API Routes      │  │  FOIA Analytics  │
│  /api/*          │  │  Components      │
│  (Next.js)       │  │  FOIADashboard   │
└────────┬─────────┘  └──────────────────┘
         │
    ┌────┴─────┐
    │           │
    ▼           ▼
┌─────────────────────────────────────────────┐
│        SUPABASE (Backend)                   │
│  ┌────────────────────────────────────────┐ │
│  │  PostgreSQL Database                   │ │
│  │  - Users & Vehicles                    │ │
│  │  - Detected Tickets                    │ │
│  │  - Contest Letters                     │ │
│  │  - FOIA Analytics Tables               │ │
│  │  - Parking & Locations                 │ │
│  │  - Attorneys & Reviews                 │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Authentication (auth.users)           │ │
│  │  - OAuth, Email/Password               │ │
│  │  - JWT Tokens                          │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Storage (bucket: ticket-photos)       │ │
│  │  - User evidence uploads               │ │
│  │  - Ticket photos                       │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Real-time (Subscriptions)             │ │
│  │  - Live updates                        │ │
│  └────────────────────────────────────────┘ │
└─────────────────┬──────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Cron     │  │External  │  │Webhooks  │
│Jobs      │  │Services  │  │Handlers  │
│Generate  │  │- Lob     │  │- Lob     │
│Letters   │  │- VA      │  │- SMS     │
│Mail      │  │- Stripe  │  │- Email   │
└──────────┘  └──────────┘  └──────────┘
```

---

## Data Flow Diagrams

### Ticket Detection & Contesting Flow

```
Vehicle Advocates (VA)
      │
      │ Monitors license plates
      │
      ▼
┌──────────────────────┐
│ Ticket Detected      │
│ (detected_tickets)   │
│ status: 'found'      │
└──────────┬───────────┘
           │
           ├─ AI analyzes ticket image
           │
           ▼
     ┌─────────────────┐
     │ User Evidence   │
     │ Requested       │
     │ status: needs_  │
     │ approval        │
     └────────┬────────┘
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
User Submits ──────► Evidence
Evidence             Received
(optional)           │
                     ▼
              ┌──────────────────────┐
              │ Contest Letter       │
              │ Generated            │
              │ (contest_letters)    │
              │ status: pending_app  │
              └────────┬─────────────┘
                       │
                       ▼
              ┌──────────────────────┐
              │ User Reviews Letter  │
              │ (approval email sent)│
              └────┬────────────┬────┘
                   │            │
            Approve │            │ Skip
                   ▼            ▼
         ┌──────────────┐  ┌──────────┐
         │Letter Status │  │status:   │
         │= approved    │  │skipped   │
         └────┬─────────┘  └──────────┘
              │
              ▼
    ┌─────────────────────────┐
    │ Cron: Mail Letters      │
    │ Send to Lob.com         │
    │ status: sent            │
    └────┬────────────────────┘
         │
         ▼
    ┌──────────────────┐
    │ Lob Webhook      │
    │ Track delivery   │
    │ Update status:   │
    │ delivered/       │
    │ returned         │
    └──────────────────┘
```

### Win Rate Analytics Population

```
FOIA DOAH Records
(2019-present)
      │
      ▼
┌───────────────────────────┐
│ Manual/Scripted Import    │
│ (separate process)        │
└────────┬──────────────────┘
         │
    ┌────┴─────┬──────────────┬──────────────┐
    │           │              │              │
    ▼           ▼              ▼              ▼
violation_win  officer_win   contest_method ward_win
_rates         _rates        _win_rates      _rates
│              │             │               │
├─ Code        ├─ Badge #    ├─ Type:       ├─ Ward #
├─ Description ├─ Name       │  written/    ├─ Total
├─ Total cases ├─ Cases      │  admin/      ├─ Wins
├─ Wins        ├─ Wins       │  court       ├─ Win %
├─ Win %       └─ Win %      └─ Win %       ├─ Avg fine
└─ Decisions                                └─ Avg days
```

---

### FOIA Analytics Query Flow

```
User Request
      │
      ▼
/api/foia/stats
      │
      ├─ type=overview
      │  └─> Fetch violation_win_rates (top 10)
      │  └─> Fetch contest_method_win_rates
      │  └─> Fetch dismissal_reasons (top 10)
      │
      ├─ type=violation
      │  └─> Query violation_win_rates
      │  └─> Order by total_contests DESC
      │  └─> Limit 50
      │
      ├─ type=ward
      │  └─> Query ward_win_rates
      │  └─> Order by ward ASC
      │
      └─ type=dismissal_reasons
         └─> Query dismissal_reasons
         └─> Order by count DESC
         └─> Limit 20
      
      ▼
┌─────────────────────────┐
│ Response JSON           │
│ {stats, totals, rates}  │
└────────────┬────────────┘
             │
             ▼
┌───────────────────────────────┐
│ UI Components                 │
│ - FOIAAnalyticsDashboard      │
│ - FOIATicketInsights          │
│ - Charts & Stats              │
└───────────────────────────────┘
```

---

### Vehicle Reminder Workflow

```
User Registration
      │
      ▼
┌──────────────────┐
│ Create Vehicle   │
│ (vehicles table) │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│ Create Obligation        │
│ (obligations table)      │
│ - city_sticker (7/31)    │
│ - emissions (12/31)      │
│ - license_plate (varies) │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Cron Job: Check Upcoming Dates  │
│ Daily at midnight               │
└────────┬─────────────────────────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             ▼
Due in 30 days      Due in 7,3,1,0 days
    │                             │
    ├─ Create Reminder            └─ Create Reminder
    ├─ Lookup user preferences    └─ Send notification
    ├─ Send via email/SMS           (email/SMS/push)
    └─ Update reminders table       └─ Log to reminders
                                      table
```

---

## Database Schema: Three Main Areas

```
┌─────────────────────────────────────────────────────────────┐
│ USER & VEHICLE MANAGEMENT                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  auth.users (Supabase managed)                              │
│      ↓                                                      │
│  users ─────┬──→ vehicles                                   │
│             │        ↓                                      │
│             │    obligations                                │
│             │        ↓                                      │
│             └─→ reminders (log)                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ TICKET CONTESTING & AUTOMATION                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  detected_tickets                                           │
│      ├─ ticket_number, violation_type, amount              │
│      ├─ status (pipeline)                                  │
│      ├─ user_evidence (JSONB)                              │
│      ├─ evidence_deadline                                  │
│      └─→ contest_letters                                   │
│              ├─ letter_content (generated)                 │
│              ├─ defense_type                               │
│              ├─ evidence_integrated                        │
│              ├─ lob_letter_id (Lob tracking)              │
│              ├─ lob_status (delivery tracking)            │
│              └─ delivery info (dates, tracking #)         │
│                                                            │
│  ticket_contests (user-submitted)                          │
│      ├─ ticket_photo_url                                  │
│      ├─ contest_letter                                    │
│      ├─ status (draft → submitted → outcome)              │
│      └─ filing_method (self/attorney/ticketless)          │
│                                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ANALYTICS & REFERENCE DATA (Read-Only from FOIA)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  violation_win_rates                                        │
│      ├─ violation_code, description                        │
│      ├─ total_contests, wins, losses                       │
│      └─ win_rate_percent                                   │
│                                                            │
│  officer_win_rates ─────────────────┐                      │
│  contest_method_win_rates ──────────┼─→ Analytics UI      │
│  ward_win_rates ───────────────────┬┘                      │
│  dismissal_reasons                 │                      │
│                                    │                      │
│  (All synced from FOIA DOAH data)  │                      │
│                                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend
- **Framework:** Next.js 14+ (React)
- **Language:** TypeScript
- **UI:** Tailwind CSS, React components
- **State:** React hooks, Supabase client
- **Charts:** Chart libraries (TBD from components)

### Backend
- **Platform:** Next.js API Routes
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (OAuth, Email)
- **Storage:** Supabase Storage (S3-compatible)
- **Real-time:** Supabase Realtime
- **Cron:** Next.js API routes + external cron service

### External Services
- **Mail:** Lob.com (print & mail API)
- **Payment:** Stripe
- **Ticket Detection:** Vehicle Advocates (VA)
- **Email:** Resend
- **SMS:** (TBD)
- **Utility Data:** UtilityAPI

### DevOps
- **Hosting:** Vercel (Next.js)
- **Database:** Supabase Cloud
- **Monitoring:** (TBD)
- **CI/CD:** Git + Vercel auto-deploy

---

## Key Features by System

### Ticket Contesting (Autopilot)
- Automatic ticket detection from Vehicle Advocates
- AI-powered contest letter generation
- Evidence submission & integration
- Letter approval workflow (with email notifications)
- Lob.com integration for printing & mailing
- Delivery tracking (USPS)
- User evidence storage (photos, videos, documents)

### Vehicle Reminders
- City sticker renewal tracking
- Emissions test reminders
- License plate renewal tracking
- Multiple reminder channels (email, SMS, push)
- Customizable reminder timing (30/14/7/3/1/0 days)
- Auto-renewal support

### Analytics & Insights
- FOIA historical data (2019-present, ~5000+ cases)
- Win rates by violation type
- Contest method effectiveness
- Officer statistics
- Geographic (ward) analysis
- Dismissal reason patterns
- Real-time dashboards

### Attorney Services
- Attorney directory
- Case specialization tracking
- Win rate statistics per attorney
- User reviews
- Quote request workflow

### Parking Assistance
- Parking location history
- Street cleaning schedule lookup
- Residential permit zone detection
- Favorite parking spots
- Real-time restriction warnings

---

## Request/Response Flow

### Typical API Request

```
Client Request
    │
    ▼
Next.js API Route
    │
    ├─ Validate request
    ├─ Check auth (JWT)
    ├─ Apply middleware (admin check, etc.)
    │
    ▼
Supabase Query
    │
    ├─ Pass JWT token
    ├─ RLS policies automatically applied
    ├─ Filter by user_id (if user-scoped)
    │
    ▼
PostgreSQL Database
    │
    ├─ Execute query
    ├─ Apply RLS checks
    ├─ Return filtered results
    │
    ▼
API Response
    │
    └─ JSON with success/error
```

---

## Scalability Considerations

### Current Scale
- Users: Hundreds to thousands
- Tickets: Thousands (with VA monitoring)
- Reminders: Tens of thousands annually
- Analytics data: 5000+ historical records

### Bottlenecks (if scaling to millions)
1. `detected_tickets` table growth (can add partitioning)
2. `parking_location_history` volume (archive old data)
3. FOIA analytics refresh time (schedule off-peak)
4. Real-time updates (use Realtime subscriptions)

### Optimization Strategies
- Database indexes on high-traffic columns (✓ done)
- Query pagination (✓ implemented)
- Caching layer (Redis could be added)
- Analytics pre-aggregation (✓ FOIA tables)
- Archive old records (recommended)

---

## Security Model

### Authentication
- Supabase Auth (managed service)
- OAuth providers (Google, etc.)
- Email/password with verification
- JWT tokens for API calls

### Authorization (RLS)
- Row Level Security on all user-scoped tables
- Service role bypasses RLS (for admin operations)
- Email-based admin checks (`auth.jwt() ->> 'email'`)
- Storage policies by folder structure

### Data Protection
- All user data encrypted at rest (Supabase managed)
- HTTPS/TLS in transit
- No hardcoded secrets (environment variables)
- Audit logs for admin actions

---

## Deployment Pipeline

```
Code Push to GitHub
    │
    ▼
GitHub Hooks
    │
    ▼
Vercel Build
    │
    ├─ Install dependencies
    ├─ Run lint/tests
    ├─ Build Next.js app
    ├─ Create serverless functions
    │
    ▼
Vercel Deploy
    │
    ├─ Update DNS
    ├─ Start new instances
    ├─ Warm containers
    │
    ▼
Prod Environment
    ├─ API routes live
    ├─ Web app live
    ├─ Cron jobs configured
    └─ Connected to Supabase
```

---

## Monitoring & Logging

### What's Tracked
- API request logs (via Next.js)
- Database queries (via Supabase)
- Audit logs (created_at, action_type, user_id)
- Cron job execution (logs in API)
- Email/SMS delivery (via Resend/provider logs)
- Payment transactions (via Stripe)

### Access Points
- Admin dashboard (`/pages/admin/`)
- Audit logs table (`audit_logs`)
- Real-time updates (Supabase console)

