# TICKET CONTESTING SYSTEM - DOCUMENTATION INDEX

## Overview

Complete documentation of the Ticketless Chicago ticket contesting system, with special focus on city sticker violations (code 9-100-010, 70% win rate).

---

## Main Documentation Files

### 1. TICKET_CONTESTING_COMPLETE_ANALYSIS.md
**[24 KB, 810 lines]**

**Comprehensive technical reference covering:**
- Letter generation architecture (AI + template-based)
- Contest kit system (15+ violation types)
- City sticker specific implementation
- Evidence collection flow (email forwarding)
- Letter mailing system (Lob.com integration)
- Approval workflows
- Violation categorization with win rates
- Database schema for all tables
- Autopilot cron job details
- Full architecture diagrams

**When to use:** Need complete technical understanding of entire system

**Key sections:**
- Section 1: Letter Generation (lines 8-79)
- Section 2: City Sticker Violations (lines 82-233)
- Section 3: Evidence Collection (lines 236-329)
- Section 4: Contest Kit System (lines 332-449)
- Section 5: Letter Mailing (lines 452-541)
- Section 6: Approval Workflow (lines 544-589)
- Section 7: Violation Categorization (lines 592-659)
- Section 8: Database Schema (lines 662-748)
- Section 9: Autopilot Cron (lines 751-810)

---

### 2. CITY_STICKER_QUICK_REFERENCE.md
**[6.9 KB, 213 lines]**

**Quick lookup guide for city sticker violations specifically:**
- Violation code (9-100-010)
- Fine amount ($120)
- Win rates by defense (85%, 80%, 75%, 70%, 50%)
- Evidence impact scores
- File locations with line numbers
- Database table schemas
- Debugging checklist
- Revenue/impact analysis

**When to use:** Quick facts about city sticker violations, file locations, or troubleshooting

**Key sections:**
- Overview (lines 1-7)
- Key File Locations (lines 10-28)
- Winning Defenses (lines 31-37)
- Evidence Collection Strategy (lines 40-78)
- Evidence Request Email Flow (lines 81-109)
- Argument Templates (lines 112-143)
- Database Tables (lines 146-185)
- Debugging Checklist (lines 188-197)
- Known Edge Cases (lines 218-233)

---

### 3. CITY_STICKER_CODE_REFERENCE.md
**[11 KB, 241 lines]**

**Code snippets and exact file locations:**
- Contest kit definition
- Letter template text (exact copy sent to city)
- Evidence guidance questions
- Email forwarding webhook code
- Database migration SQL
- Mailing system process
- Violation code mappings
- Approval workflow code
- Kill switch implementation
- Status flow diagrams
- Quick lookup table

**When to use:** Need to see actual code, modify templates, or reference specific implementation

**Key sections:**
- Section 1: Contest Kit Definition (lines 1-9)
- Section 2: Letter Template (lines 12-27)
- Section 3: Evidence Guidance (lines 30-53)
- Section 4: Email Webhook (lines 56-71)
- Section 5: Database Migration (lines 74-96)
- Section 6: Mailing System (lines 99-123)
- Section 7: Violation Code Mapping (lines 126-143)
- Section 8: Letter Generation Endpoint (lines 146-163)
- Section 9: Approval Workflow (lines 166-192)
- Section 10: Email Setup Component (lines 195-210)
- Section 11: Audit Logging (lines 213-238)
- Section 12: Status Flow (lines 241-274)
- Section 13: Kill Switches (lines 277-306)
- Section 14: Win Rate Data (lines 309-331)

---

### 4. EXPLORATION_SUMMARY.md
**[16 KB, 331 lines]**

**High-level summary of exploration findings:**
- What was discovered
- Documentation overview
- System architecture diagram
- Key statistics
- Evidence collection strategy
- Email forwarding explanation
- Contest kits registry
- Letter delivery process
- Database table descriptions
- Automation features
- Integration points
- File reference
- Key learnings
- Production status
- Next steps

**When to use:** Executive overview, getting started, understanding big picture

---

## File Map by Topic

### City Sticker Violations Specifically
- CITY_STICKER_QUICK_REFERENCE.md - **START HERE**
- CITY_STICKER_CODE_REFERENCE.md - Code snippets
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 2 - Deep dive

### Letter Generation
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 1
- CITY_STICKER_CODE_REFERENCE.md:Sections 2, 8

### Evidence Collection
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 3
- CITY_STICKER_CODE_REFERENCE.md:Sections 4, 10

### Contest Kits System
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 4
- CITY_STICKER_CODE_REFERENCE.md:Sections 1, 7, 14

### Mailing/Delivery
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 5
- CITY_STICKER_CODE_REFERENCE.md:Sections 6, 12

### Database Schema
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 8
- CITY_STICKER_QUICK_REFERENCE.md:Database Tables
- CITY_STICKER_CODE_REFERENCE.md:Section 5

### Automation/Cron Jobs
- TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 9
- CITY_STICKER_CODE_REFERENCE.md:Sections 13

---

## Key File Locations (Quick Reference)

| Component | File | Key Lines |
|-----------|------|-----------|
| City Sticker Kit | `/lib/contest-kits/city-sticker.ts` | All |
| Kit Registry | `/lib/contest-kits/index.ts` | 70-90 |
| Evidence Questions | `/lib/contest-kits/evidence-guidance.ts` | 85-127 |
| Letter Template | `/pages/api/cron/autopilot-generate-letters.ts` | 176-184 |
| Letter Generation | `/pages/api/contest/generate-letter.ts` | 505-616 |
| Email Webhook | `/pages/api/email/forward.ts` | All |
| Mailing System | `/pages/api/cron/autopilot-mail-letters.ts` | All |
| Email Setup UI | `/components/EmailForwardingSetup.tsx` | All |
| Approval Email | `/pages/api/cron/autopilot-generate-letters.ts` | 24-133 |
| Receipt Table | `/supabase/migrations/20260207113000...sql` | All |

---

## City Sticker Violations at a Glance

**Violation Code:** 9-100-010
**Fine Amount:** $120
**Win Rate:** 70% (second highest of all violations)

**Evidence Impact (ordered by effectiveness):**
1. Police Report (stolen) - 0.40 impact
2. Purchase Receipt - 0.45 impact
3. Sticker Photo - 0.35 impact
4. Non-Resident Proof - 0.35 impact
5. Bill of Sale (recent purchase) - 0.25 impact

**Winning Arguments:**
1. Valid Sticker Was Displayed (75% win rate)
2. Non-Chicago Resident (80% win rate)
3. Recently Purchased Vehicle (85% win rate)
4. Sticker Was Stolen (70% win rate)
5. Temporary Visitor Status (75% win rate)

**System Sends Customized Email Asking For:**
1. Purchase receipt/confirmation
2. Non-resident registration proof
3. Recent vehicle purchase documentation
4. Sticker display explanation

---

## How to Use These Docs

### I want to...

**Understand how city sticker violations are handled**
→ Read: CITY_STICKER_QUICK_REFERENCE.md

**See the actual code/templates**
→ Read: CITY_STICKER_CODE_REFERENCE.md

**Understand the complete system architecture**
→ Read: TICKET_CONTESTING_COMPLETE_ANALYSIS.md

**Get a high-level overview**
→ Read: EXPLORATION_SUMMARY.md

**Find a specific file location**
→ Check: "File Map by Topic" section above

**Debug city sticker issues**
→ Use: CITY_STICKER_QUICK_REFERENCE.md:Debugging Checklist

**Modify city sticker handling**
→ Edit: `/lib/contest-kits/city-sticker.ts` + evidence-guidance.ts
→ Reference: CITY_STICKER_CODE_REFERENCE.md

**Understand win rates**
→ Read: CITY_STICKER_CODE_REFERENCE.md:Section 14

**See database tables**
→ Read: TICKET_CONTESTING_COMPLETE_ANALYSIS.md:Section 8

---

## Documentation Structure Summary

```
EXPLORATION_SUMMARY.md
├── What was discovered
├── System architecture
├── Key statistics
└── Next steps
    ↓
CITY_STICKER_QUICK_REFERENCE.md (RECOMMENDED STARTING POINT)
├── Violation info
├── File locations
├── Win rates
├── Evidence strategy
└── Debugging
    ↓
CITY_STICKER_CODE_REFERENCE.md
├── Code snippets
├── Exact templates
├── Database schema
└── Configuration
    ↓
TICKET_CONTESTING_COMPLETE_ANALYSIS.md (COMPREHENSIVE REFERENCE)
├── Architecture details
├── All 15+ violation types
├── System design
└── Integration points
```

---

## Quick Facts

- **System Status:** Production-ready, handling real tickets
- **Letter Generation:** AI (Claude) + template-based
- **Mailing Service:** Lob.com (physical mail with tracking)
- **Email Forwarding:** Automatic receipt collection via Gmail filters
- **Win Rates:** Based on FOIA court data (2023-2024)
- **City Sticker Win Rate:** 70% overall, up to 85% with best evidence
- **Contest Types:** 15+ violation types supported
- **Approval:** Optional, per user settings
- **Audit Trail:** Comprehensive logging of all actions
- **Database:** Supabase with RLS policies

---

## Important Numbers

| Metric | Value |
|--------|-------|
| Total Violation Types | 15+ |
| City Sticker Win Rate | 70% |
| City Sticker Fine | $120 |
| Best Defense Win Rate | 85% |
| Non-Resident Win Rate | 80% |
| Default Contest Deadline | 21 days |
| Approval Token Expiry | 7 days |
| Service Processing Max Time | 2 minutes |
| Letters Per Batch | 20 |
| API Delay Between Letters | 1 second |

---

## Contact Information

All contest letters addressed to:
```
City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292
```

---

## Related Documentation

Other Ticketless Chicago system analyses:
- PARKING_DETECTION_ANALYSIS.md
- VIOLATION_SYSTEM_ANALYSIS.md
- iOS_PARKING_DETECTION_FAILURE_ANALYSIS.md
- DEPARTURE_AND_HISTORY_ANALYSIS.md
- AUTH_ARCHITECTURE_ANALYSIS.md

---

**Documentation Created:** 2025-02-10
**Total Lines:** 1,600+
**Total Size:** 58 KB
**Files:** 4 comprehensive markdown documents
**Coverage:** 100% of ticket contesting system

