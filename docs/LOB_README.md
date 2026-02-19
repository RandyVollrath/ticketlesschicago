# Lob Integration Documentation Index

This directory contains comprehensive documentation of the Lob.com integration for mailing parking contest letters.

## Quick Navigation

### Choose your depth level:

**Just need the basics? Start here:**
- **[LOB_INTEGRATION_SUMMARY.md](./LOB_INTEGRATION_SUMMARY.md)** ← START HERE
  - 5-minute executive summary
  - Critical conditions for mailing
  - Kill switches explained
  - Common issues and fixes

**Need detailed flow understanding?**
- **[LOB_FLOW_QUICK_REFERENCE.txt](./LOB_FLOW_QUICK_REFERENCE.txt)**
  - Step-by-step process
  - All major decision points
  - Kill switches and test prevention
  - Database tables involved

**Want complete technical details?**
- **[LOB_INTEGRATION_FLOW.md](./LOB_INTEGRATION_FLOW.md)**
  - 12 comprehensive sections
  - Every API endpoint
  - All database operations
  - Troubleshooting guide

**Need to modify the code?**
- **[LOB_CODE_FLOW.md](./LOB_CODE_FLOW.md)**
  - Detailed pseudocode
  - Line-by-line execution flow
  - Database state changes
  - Error handling patterns

---

## The 30-Second Overview

```
STEP 1: VA uploads CSV with ticket data
        ↓
STEP 2: Ticket created, letter generated, user emailed (Day 17 deadline)
        ↓
STEP 3: Wait until Day 17 from ticket issue date...
        ↓
STEP 4: Daily cron (3 PM UTC) checks if deadline passed
        ↓
STEP 5: If yes → Call Lob API to mail letter
        ↓
STEP 6: Lob prints, envelopes, mails via USPS
        ↓
STEP 7: User receives letter in 3-5 business days
```

---

## Critical Things to Know

### Kill Switches (Emergency Stops)

1. **pause_all_mail** - Stops all mailing gracefully
   - Set in `autopilot_admin_settings` table
   - Returns 200 OK (no error)

2. **is_test** - Prevents individual ticket from mailing
   - Set on `detected_tickets.is_test = true`
   - Safe for testing

3. **evidence_deadline** - Controls when letter mails
   - Set on `detected_tickets.evidence_deadline`
   - Letter won't mail until deadline passes

### LOB_API_KEY

**Required for mailing to work**
- Set as environment variable
- Used in `lib/lob-service.ts`
- Checked in `pages/api/cron/autopilot-mail-letters.ts`
- If missing: returns 500 error

### Cron Schedule

- **File**: `vercel.json`
- **Time**: Daily at 3:00 PM UTC
- **Endpoint**: `/api/cron/autopilot-mail-letters`
- **Duration**: Max 120 seconds

---

## File Purposes

| File | Purpose | Best For |
|------|---------|----------|
| LOB_INTEGRATION_SUMMARY.md | Executive overview | Decision makers, quick understanding |
| LOB_FLOW_QUICK_REFERENCE.txt | Single-page reference | Quick lookup, debugging |
| LOB_INTEGRATION_FLOW.md | Complete technical guide | Developers, detailed questions |
| LOB_CODE_FLOW.md | Code-level execution | Modifying code, understanding logic |

---

## Common Tasks

### "How do I prevent mailing from happening?"

See: **LOB_INTEGRATION_SUMMARY.md → Kill Switches**

Quick answer: Set `pause_all_mail` in database

### "Letters aren't being mailed, why?"

See: **LOB_INTEGRATION_SUMMARY.md → Common Issues & Solutions**

Quick answer: Check LOB_API_KEY, kill switches, evidence deadline, user address

### "What happens when I upload a CSV?"

See: **LOB_FLOW_QUICK_REFERENCE.txt → STEP 1: CSV UPLOAD & PARSING**

Quick answer: Ticket created, letter generated, user emailed

### "I need to modify the mailing code"

See: **LOB_CODE_FLOW.md → 2. Letter Mailing: autopilot-mail-letters.ts**

Quick answer: Check execution flow, database operations, error handling

### "What are all the status values?"

See: **LOB_INTEGRATION_SUMMARY.md → Status Values**

Quick answer: pending_evidence, mailed, failed, needs_approval, etc.

---

## Source Code Files

The actual implementation is in these files:

```
pages/
├── api/
│   ├── admin/autopilot/
│   │   └── upload-results.ts           (1,022 lines)
│   │       Entry point for VA CSV upload
│   │
│   └── cron/
│       ├── autopilot-generate-letters.ts (627 lines)
│       │   Generates letters (separate process)
│       │
│       └── autopilot-mail-letters.ts    (520 lines)
│           Main mailing cron job
lib/
└── lob-service.ts                      (150 lines)
    Lob.com API integration
```

---

## Database Schema Overview

### Key Tables

**detected_tickets**
- Stores parking tickets detected
- Status: pending_evidence → mailed
- evidence_deadline: Day 17 from ticket issue date (see PRODUCT_DECISIONS.md)
- is_test: flag to prevent mailing

**contest_letters**
- Stores generated contest letters
- Status: pending_evidence → mailed
- lob_letter_id: tracking from Lob API
- letter_pdf_url: downloadable PDF

**autopilot_admin_settings**
- Admin controls
- pause_all_mail: kill switch for mailing
- Other settings: kill_all_mailing, maintenance_mode

**ticket_audit_log**
- Audit trail of all actions
- ticket_detected, letter_generated, letter_mailed, letter_mail_failed

**autopilot_subscriptions**
- User subscription info
- letters_used_this_period: billing counter

---

## Testing Checklist

Before testing mailing:

- [ ] Set `is_test = true` on test tickets
- [ ] OR enable `pause_all_mail` kill switch
- [ ] OR set evidence_deadline to future date
- [ ] Check LOB_API_KEY is NOT set (or use test key)
- [ ] Review test email addresses

After testing mailing:

- [ ] Check `contest_letters.status = 'mailed'`
- [ ] Check `lob_letter_id` is populated
- [ ] Check `letter_pdf_url` is populated
- [ ] Check audit log: `action = 'letter_mailed'`
- [ ] Check `letters_used_this_period` incremented

---

## Environment Variables

Required:
```bash
LOB_API_KEY=[your lob api key]
SUPABASE_SERVICE_ROLE_KEY=[supabase key]
NEXT_PUBLIC_SUPABASE_URL=[supabase url]
CRON_SECRET=[secret for cron verification]
RESEND_API_KEY=[resend email api key]
```

---

## Documentation Maintenance

These docs were generated from source code analysis on 2026-01-09.

If code changes, update the relevant documentation:
- Change in upload-results.ts? → Update LOB_INTEGRATION_FLOW.md Section 1
- Change in autopilot-mail-letters.ts? → Update Section 4
- Change in lob-service.ts? → Update Section 5
- Change in vercel.json cron? → Update all files

---

## Quick Links

- Source code: `/pages/api/admin/autopilot/upload-results.ts`
- Mailing cron: `/pages/api/cron/autopilot-mail-letters.ts`
- Lob service: `/lib/lob-service.ts`
- Config: `/vercel.json`

---

## Questions?

Refer to the appropriate doc:

1. **"What?"** → LOB_INTEGRATION_SUMMARY.md
2. **"How?"** → LOB_FLOW_QUICK_REFERENCE.txt
3. **"Why?"** → LOB_INTEGRATION_FLOW.md
4. **"Show me the code"** → LOB_CODE_FLOW.md

