# Ticketless Chicago - Database Documentation Index

**Start here to understand the codebase and database schema.**

---

## Three-Part Documentation Set

### 1. **CODEBASE_SCHEMA_SUMMARY.md** (833 lines)
**The Complete Reference** - In-depth documentation of every database table

**Use this when you need:**
- Complete list of all 35+ tables
- Full column definitions for each table
- Data relationships and foreign keys
- Existing analytics features
- FOIA data structure
- RLS policies
- Background processes/cron jobs
- Future enhancement opportunities

**Key Sections:**
- Ticket detection & contesting system
- FOIA analytics tables (violation_win_rates, officer_win_rates, etc.)
- Vehicle reminders & obligations
- Parking location tracking
- Attorney management
- Geographic/ward data
- Existing dashboards & analytics

---

### 2. **DATABASE_QUICK_REFERENCE.md** (295 lines)
**Quick Lookup** - Tables at a glance, cheat sheet format

**Use this when you need:**
- Quick table lookup with key fields
- Entity relationship diagram
- Violation type list
- Status pipeline diagrams
- API endpoint listing
- RLS policy summary
- Common SQL queries
- Data dictionary

**Best for:**
- During development when you need quick lookups
- Understanding relationships between tables
- Reference while coding
- Query examples

---

### 3. **ARCHITECTURE_OVERVIEW.md** (518 lines)
**System Design** - How everything fits together

**Use this when you need:**
- System architecture diagram
- Data flow visualizations
- Technology stack details
- Request/response flow
- Scalability considerations
- Security model
- Deployment pipeline
- Key features overview

**Best for:**
- Understanding the big picture
- Architecture decisions
- Onboarding new developers
- System design discussions

---

## What Each Document Contains

```
CODEBASE_SCHEMA_SUMMARY.md
├─ Executive Summary (3 subsystems)
├─ Ticket Detection & Contesting (3 tables + violation types)
├─ FOIA Analytics (5 stat tables + 3 API endpoints)
├─ Vehicle Reminders & Renewals (4 core tables + views)
├─ Parking Location Tracking (4 location tables)
├─ Additional Support Tables (attorneys, audit logs, etc.)
├─ Geographic/Location Data (wards, sections, PostGIS)
├─ Existing Analytics Features (dashboard pages, API endpoints)
├─ Data Relationships (visual diagram)
├─ Performance Indexes
├─ RLS Policies (detailed)
├─ Cron Jobs (4 background processes)
├─ Enhancement Opportunities (9 ideas)
├─ File References
└─ Summary Statistics

DATABASE_QUICK_REFERENCE.md
├─ Core Tables at a Glance (3 tables × 3 areas)
├─ Entity Relationships (simple diagram)
├─ Violation Types (10 types)
├─ Ticket Status Pipeline
├─ Letter Status Pipeline
├─ API Endpoints by Function
├─ Important Indexes
├─ RLS Policies (summary)
├─ Common Queries (4 examples)
├─ Data Dictionary (field definitions)
├─ Migration History (recent migrations)
└─ Performance Notes

ARCHITECTURE_OVERVIEW.md
├─ System Architecture Diagram
├─ Data Flow Diagrams (3 flows)
├─ Database Schema Areas (3 main sections)
├─ Technology Stack
├─ Key Features by System (5 areas)
├─ Request/Response Flow
├─ Scalability Considerations
├─ Security Model
├─ Deployment Pipeline
└─ Monitoring & Logging
```

---

## Key Database Areas Covered

### 1. Ticket Contesting System
- `detected_tickets` - Tickets found by autopilot
- `contest_letters` - Generated contest letters
- `ticket_contests` - User-submitted contests
- Status pipeline (found → mailed → won/lost)
- Lob.com integration for delivery

**Documentation:** CODEBASE_SCHEMA_SUMMARY.md Section 1 + QUICK_REFERENCE Violation Types

---

### 2. FOIA Analytics (Historical Data)
- `violation_win_rates` - Win rates by violation type
- `officer_win_rates` - Officer statistics
- `contest_method_win_rates` - Contest method effectiveness
- `ward_win_rates` - Geographic analysis
- `dismissal_reasons` - Common dismissal reasons
- ~5,000+ historical records (2019-present)

**Documentation:** CODEBASE_SCHEMA_SUMMARY.md Section 2 + QUICK_REFERENCE Analytics

---

### 3. Vehicle Reminders
- `users` - User profiles
- `vehicles` - User vehicles
- `obligations` - Renewal deadlines (city_sticker, emissions, license_plate)
- `reminders` - Notification log
- Customizable reminder timing

**Documentation:** CODEBASE_SCHEMA_SUMMARY.md Section 3 + ARCHITECTURE workflow diagram

---

### 4. Parking & Location Data
- `parking_location_history` - Parking sessions
- `saved_parking_location` - Favorite spots
- `street_cleaning_schedule` - Street cleaning by ward
- `parking_permit_zones` - Reference data from Chicago Open Data

**Documentation:** CODEBASE_SCHEMA_SUMMARY.md Section 4

---

### 5. Supporting Features
- **Attorney Services:** `attorneys`, `attorney_case_expertise`, `attorney_reviews`, `attorney_quote_requests`
- **Audit & Admin:** `audit_logs`, `reimbursement_requests`
- **Property Tax:** `property_tax_deadlines`, `property_tax_appeals`
- **Subscriptions:** `autopilot_subscriptions`, `monitored_plates`

**Documentation:** CODEBASE_SCHEMA_SUMMARY.md Section 5

---

## How to Use These Documents

### For New Feature Development
1. Start with **QUICK_REFERENCE.md** to understand related tables
2. Check **CODEBASE_SCHEMA_SUMMARY.md** for complete column definitions
3. Look at **ARCHITECTURE_OVERVIEW.md** for data flow implications
4. Reference the SQL examples in QUICK_REFERENCE

### For Analytics/Reporting
1. Go to QUICK_REFERENCE.md → "FOIA Analytics" section
2. Check CODEBASE_SCHEMA_SUMMARY.md Section 2 for full table definitions
3. Review existing endpoints in Section 7 to avoid duplication
4. Use SQL query examples as templates

### For Bug Fixing
1. Check QUICK_REFERENCE.md for status pipelines
2. Look at RLS policies in both QUICK_REFERENCE and CODEBASE documents
3. Reference the indexes to understand query performance
4. Check cron jobs if it's a data consistency issue

### For System Design Changes
1. Study ARCHITECTURE_OVERVIEW.md diagrams
2. Review data relationships in CODEBASE Section 8
3. Consider scalability notes in ARCHITECTURE Section "Scalability Considerations"
4. Check RLS implications in both documents

### For Performance Optimization
1. Review QUICK_REFERENCE.md "Important Indexes"
2. Study ARCHITECTURE "Scalability Considerations"
3. Check CODEBASE Section 9 "IMPORTANT INDEXES & PERFORMANCE"
4. Review high-traffic tables in CODEBASE "Support Tables"

---

## File Locations

All documentation is in the root directory:

```
/home/randy-vollrath/ticketless-chicago/
├── CODEBASE_SCHEMA_SUMMARY.md          ← Main reference
├── DATABASE_QUICK_REFERENCE.md         ← Quick lookups
├── ARCHITECTURE_OVERVIEW.md            ← System design
├── DATABASE_DOCUMENTATION_INDEX.md     ← This file
└── [all other project files...]
```

---

## Quick Stats

**Tables & Structures:**
- 35+ database tables
- 3 major subsystems
- 9 FOIA analytics tables
- 5 key data relationships

**Data Volume:**
- FOIA data: 5,000+ historical records (2019-present)
- Unlimited ticket detection capacity
- Thousands of users/vehicles
- Real-time location tracking

**Code Coverage:**
- 1,646 lines of documentation
- All tables documented
- All existing features covered
- Performance & scalability notes

---

## Important Concepts

### Ticket Status Pipeline
```
found → needs_approval → evidence_received → pending_evidence
    → letter_generated → mailed → delivered → won/lost
```

### Letter Status Pipeline
```
draft → pending_approval → approved → sent → delivered
```

### Key Tables
1. **detected_tickets** - Central hub for autopilot tickets
2. **contest_letters** - Links to ticket with delivery tracking
3. **violation_win_rates** - Pre-calculated analytics
4. **users** + **vehicles** - Customer data
5. **obligations** - Renewal reminders

### Geographic Hierarchy
- **Ward** (1-50) - Political district
- **Section** - Subdivision for street cleaning
- Used in `street_cleaning_schedule`, `parking_location_history`, `ward_win_rates`

---

## Common Tasks & Where to Find Answers

| Task | Document | Section |
|------|----------|---------|
| Add new ticket field | CODEBASE | Section 1 |
| Query user's tickets | QUICK_REFERENCE | Common Queries |
| Check win rate | QUICK_REFERENCE | FOIA Analytics |
| Fix RLS issue | CODEBASE or QUICK_REFERENCE | RLS Policies |
| Optimize query | QUICK_REFERENCE | Important Indexes |
| Understand data flow | ARCHITECTURE | Data Flow Diagrams |
| Add analytics feature | CODEBASE | Section 7 |
| Scale to more users | ARCHITECTURE | Scalability |
| Understand attorney feature | CODEBASE | Section 5 |

---

## Connected Resources

**In the Codebase:**
- `/supabase/migrations/` - Database migrations
- `/pages/api/` - API endpoints
- `/components/FOIAAnalyticsDashboard.tsx` - Analytics UI
- `/pages/dashboard.tsx` - Main dashboard
- `/types/index.ts` - TypeScript interfaces

**External Services:**
- Supabase Console - Database management
- Lob.com - Mail delivery
- Vehicle Advocates - Ticket detection
- Stripe - Payments
- Resend - Email

---

## Documentation Version

Created: January 21, 2026

**Based on:**
- Supabase migrations up to 2025-01-05
- All current API endpoints
- All active features as of main branch
- Codebase state: 6d32751a (latest commit)

**Next Steps to Keep Updated:**
- Update after major schema migrations
- Add new sections when new features are added
- Refresh FOIA data counts periodically
- Document any new API endpoints

---

## Questions?

Each document has a specific focus:

- **"How do I..."** → QUICK_REFERENCE.md
- **"What fields does this table have?"** → CODEBASE_SCHEMA_SUMMARY.md
- **"How does the system work?"** → ARCHITECTURE_OVERVIEW.md
- **"I need a complete reference"** → CODEBASE_SCHEMA_SUMMARY.md

All three documents are cross-referenced and complementary.

