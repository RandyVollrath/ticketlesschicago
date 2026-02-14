# Ticketless Chicago - Quick Database Reference

## Core Tables at a Glance

### Ticket Contesting System
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `detected_tickets` | Tickets found by autopilot | id, user_id, plate, ticket_number, violation_type, status, amount, user_evidence |
| `contest_letters` | Generated contest letters | id, ticket_id, user_id, letter_content, status, lob_status, mailed_at |
| `ticket_contests` | User-submitted contests | id, user_id, ticket_photo_url, status, contest_letter, filing_method |

### Vehicle & Obligation Tracking
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `users` | User profiles | id, email, phone, notification_preferences, subscription_status |
| `vehicles` | User vehicles | id, user_id, license_plate, vin, make, model, subscription_id |
| `obligations` | Renewal deadlines | id, vehicle_id, type (city_sticker/emissions/license_plate), due_date, completed |
| `reminders` | Reminder log | id, obligation_id, sent_at, method (email/sms), days_until_due, status |

### FOIA Analytics
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `violation_win_rates` | Win rates by violation | violation_code, total_contests, wins, win_rate_percent |
| `contest_method_win_rates` | Win rates by method | contest_type, total_contests, wins, win_rate_percent |
| `officer_win_rates` | Win rates by officer | officer_badge, officer_name, total_cases, wins |
| `ward_win_rates` | Geographic win rates | ward, total_contests, wins, avg_days_to_decision |
| `dismissal_reasons` | Common dismissal reasons | reason, count, percentage, outcome |

### Parking & Location
| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `parking_location_history` | Parking sessions | user_id, latitude, longitude, parked_at, cleared_at, street_cleaning_ward |
| `saved_parking_location` | Favorite spots | user_id, latitude, longitude, nickname, has_restrictions |
| `street_cleaning_schedule` | Schedule by ward | ward, section, cleaning_date, street_name |
| `parking_permit_zones` | Permit zone reference | zone, street_name, address_range, ward_low/high |

### Support Tables
| Table | Purpose |
|-------|---------|
| `attorneys` | Attorney directory and ratings |
| `attorney_case_expertise` | Attorney specializations by violation code |
| `attorney_reviews` | User reviews of attorneys |
| `attorney_quote_requests` | Attorney quote request workflow |
| `audit_logs` | Audit trail for admin actions |
| `reimbursement_requests` | Ticket reimbursement requests |
| `property_tax_deadlines` | Property tax obligation tracking |
| `property_tax_appeals` | Property tax appeals filed |

---

## Entity Relationships

```
User Registration
auth.users (Supabase) → users → vehicles → obligations → reminders

Ticket Detection & Contesting
detected_tickets → contest_letters (with Lob tracking)
                 → user_evidence (JSONB attachments)

Analytics (Read-Only)
violation_win_rates ← FOIA data (2019-present)
officer_win_rates   ← Historical DOAH cases
ward_win_rates      ← Geographic analysis

Location Services
parking_location_history ← parking_location_latitude, longitude
                        ← street_cleaning_schedule lookup
                        ← parking_permit_zones reference
```

---

## Violation Types

```
expired_plates      - License plate expired
no_city_sticker     - Missing city sticker
expired_meter       - Parking meter expired
disabled_zone       - Parked in accessible zone
street_cleaning     - Parked during cleaning
rush_hour           - Parked in rush hour zone
fire_hydrant        - Too close to fire hydrant
red_light           - Red light camera violation
speed_camera        - Speed camera violation
other_unknown       - Other violations
```

---

## Ticket Status Pipeline

```
found 
  ↓
needs_approval (awaiting user evidence)
  ↓
evidence_received (user submitted evidence)
  ↓
pending_evidence (awaiting deadline/approval)
  ↓
letter_generated (contest letter created)
  ↓
mailed (sent via Lob.com)
  ↓
delivered (USPS delivery confirmed)
  ↓
won / lost (case outcome)
  └─ skipped (user opted out)
  └─ failed (couldn't be processed)
```

---

## Letter Status Pipeline

```
draft
  ↓
pending_approval (awaiting user review)
  ↓
approved (user approved, ready to mail)
  ↓
sent (submitted to Lob.com)
  ↓
delivered (USPS delivered)
  └─ rejected (user rejected)
  └─ failed (processing failed)
```

---

## API Endpoints by Function

### Admin Dashboard
- `GET /api/admin/autopilot/stats` → Active users, plates, pending tickets
- `GET /api/admin/contest-letters` → List all letters with filters
- `GET /api/admin/ticket-pipeline` → Tickets with lifecycle stage
- `PATCH /api/admin/contests` → Update contest status

### Analytics (Public)
- `GET /api/foia/stats?type=overview` → Summary statistics
- `GET /api/foia/stats?type=violation` → Top 50 violations
- `GET /api/foia/stats?type=violation&violation_code=XXX` → Specific violation
- `GET /api/foia/stats?type=officer` → Officer statistics
- `GET /api/foia/stats?type=method` → Contest method win rates
- `GET /api/foia/stats?type=ward` → Geographic statistics
- `GET /api/foia/stats?type=dismissal_reasons` → Top dismissal reasons

### Background Jobs (Cron)
- `POST /api/cron/autopilot-generate-letters` → Generate letters daily
- `POST /api/cron/autopilot-mail-letters` → Mail approved letters
- `POST /api/cron/autopilot-check-plates` → Check for new tickets
- `POST /api/cron/process-video-queue` → Process video evidence

---

## Important Indexes

```sql
-- Ticket queries
detected_tickets(status)
detected_tickets(user_id, created_at DESC)
detected_tickets(violation_code)

-- Letter queries
contest_letters(ticket_id)
contest_letters(status)

-- Location queries
parking_location_history(user_id, parked_at DESC)
street_cleaning_schedule(ward, section, cleaning_date)

-- Analytics queries
violation_win_rates(violation_code)
ward_win_rates(ward)

-- Audit
audit_logs(action_type, created_at DESC)
audit_logs(user_id, created_at DESC)
```

---

## RLS Policies

**User-scoped access:**
- `detected_tickets` → Users see own tickets only
- `contest_letters` → Users see own letters only
- `parking_location_history` → Users see own parking
- `vehicles`, `obligations`, `reminders` → Users see own

**Admin access (email-based):**
- Admins: `randyvollrath@gmail.com`, `carenvollrath@gmail.com`
- Can view/edit all records

**Public access:**
- `violation_win_rates` → Anyone can read
- `contest_method_win_rates` → Anyone can read
- `parking_permit_zones` → Anyone can read

---

## Common Queries

### Get user's tickets with letters
```sql
SELECT 
  dt.id, dt.ticket_number, dt.violation_type, dt.amount, dt.status,
  cl.letter_content, cl.lob_status, cl.mailed_at
FROM detected_tickets dt
LEFT JOIN contest_letters cl ON dt.id = cl.ticket_id
WHERE dt.user_id = $1
ORDER BY dt.created_at DESC;
```

### Get upcoming vehicle obligations
```sql
SELECT u.email, v.license_plate, o.type, o.due_date, 
       (o.due_date - CURRENT_DATE) as days_until_due
FROM obligations o
JOIN vehicles v ON o.vehicle_id = v.id
JOIN users u ON o.user_id = u.id
WHERE o.completed = false 
  AND o.due_date >= CURRENT_DATE
  AND o.due_date <= CURRENT_DATE + 30
ORDER BY o.due_date;
```

### Get win rates for specific violation
```sql
SELECT violation_code, violation_description, total_contests, 
       wins, win_rate_percent
FROM violation_win_rates
WHERE violation_code = $1;
```

### Get top officers by dismissal rate
```sql
SELECT officer_badge, officer_name, total_cases, wins,
       (wins::float / total_cases * 100) as dismissal_rate
FROM officer_win_rates
ORDER BY dismissal_rate DESC
LIMIT 10;
```

---

## Data Dictionary: Key Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `status` (ticket) | VARCHAR | found, needs_approval, evidence_received, pending_evidence, letter_generated, mailed, won, lost, skipped, failed | Pipeline stage |
| `violation_type` | VARCHAR | See violation types | Type of traffic/parking violation |
| `contest_type` | VARCHAR | written_hearing, administrative_hearing, court_hearing | How case was contested |
| `method` (reminder) | VARCHAR | email, sms, voice | How reminder sent |
| `lob_status` | VARCHAR | created, processing, in_transit, in_local_area, out_for_delivery, delivered, returned, re_routed | Mail delivery status |
| `defense_type` | VARCHAR | procedural_defect, factual_error, mitigating_circumstances | Type of defense used |
| `filing_method` | VARCHAR | self, attorney, ticketless | How case filed |

---

## Migration History

Latest migrations in `/supabase/migrations/`:
- `20250923002412_add_profile_fields.sql` - Added vehicle/address fields
- `add_permit_document_fields.sql` - Permit zone tracking
- `add_property_tax_payment_columns.sql` - Tax appeal tracking
- `add_utilityapi_columns.sql` - Utility bill integration
- `create_parking_permit_zones_table.sql` - Permit zone reference
- `create_audit_logs_table.sql` - Audit trail
- `create_reimbursement_requests_table.sql` - Reimbursement workflow
- `create_affiliate_commissions_table.sql` - Commission tracking

---

## Performance Notes

**High-volume tables:**
- `detected_tickets` - Can grow rapidly with VA monitoring
- `parking_location_history` - Records every parking session
- `audit_logs` - Tracks all admin actions

**Query optimization:**
- Use indexed fields in WHERE clauses
- Avoid SELECT * on large tables
- Filter by user_id or status early
- Use LIMIT for pagination

**Analytics considerations:**
- FOIA tables are static reference data (updated periodically)
- Can be queried without performance concerns
- Pre-aggregated statistics prevent expensive computations
- ward_win_rates enables geographic filtering

