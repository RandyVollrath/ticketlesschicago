# Ticketless Chicago Codebase Map: Autopilot & Permit Zones

## Project Structure

```
/home/randy-vollrath/ticketless-chicago/
├── Web App (Next.js)
├── Mobile App (React Native)
├── Database (Supabase/PostgreSQL)
└── Documentation
```

---

## Autopilot America Integration Files

### Plate Monitoring System

| Component | Files | Purpose |
|-----------|-------|---------|
| **Plate Checker** | `/pages/api/cron/autopilot-check-plates.ts` | Fetches tickets from Chicago Data Portal by license plate |
| **Plate Monitoring** | Database: `monitored_plates` table | Stores user license plates being monitored |
| **Detected Tickets** | Database: `detected_tickets` table | Stores found tickets for users |
| **Subscriptions** | Database: `autopilot_subscriptions` table | Tracks Autopilot paid subscriptions |
| **Admin Dashboard** | `/pages/admin/autopilot.tsx` | Admin panel for Autopilot management |

### Letter Generation & Mailing

| Component | Files | Purpose |
|-----------|-------|---------|
| **Letter Generator** | `/pages/api/cron/autopilot-generate-letters.ts` | Generates contest letters for tickets |
| **Mail Handler** | `/pages/api/cron/autopilot-mail-letters.ts` | Sends letters via Lob |
| **Export System** | `/pages/api/cron/autopilot-export-plates.ts` | Exports plates for processing |

### Settings & Configuration

| Component | Files | Purpose |
|-----------|-------|---------|
| **Settings Tables** | Database: `autopilot_settings` | User Autopilot configuration |
| **Admin Settings** | Database: `autopilot_admin_settings` | Admin kill switches & maintenance mode |

---

## Permit Zone System Files

### Database Schema

```
parking_permit_zones (14,000+ records)
├── zone (TEXT) - Zone ID
├── status (TEXT) - ACTIVE/INACTIVE
├── address_range_low (INTEGER)
├── address_range_high (INTEGER)
├── street_name (TEXT)
├── street_direction (TEXT) - N/S/E/W
├── street_type (TEXT) - ST/AVE/BLVD
├── odd_even (TEXT) - O/E/NULL
└── ward_low/high (INTEGER)

parking_permit_zones_sync (Metadata)
├── last_synced_at
├── total_records
├── sync_status
└── error_message
```

### Core Files

| File | Type | Purpose |
|------|------|---------|
| `/supabase/migrations/create_parking_permit_zones_table.sql` | SQL | Database schema |
| `/pages/api/cron/sync-permit-zones.ts` | API | Weekly data sync from Chicago |
| `/pages/api/check-permit-zone.ts` | API | Address-based permit zone lookup |
| `/pages/api/mobile/check-parking.ts` | API | Mobile unified parking checker |
| `/lib/address-parser.ts` | Library | Parses Chicago addresses |
| `/lib/permit-zone-time-validator.ts` | Library | Validates restriction times |
| `/lib/permit-zone-messaging.ts` | Library | User messaging templates |
| `/lib/unified-parking-checker.ts` | Library | Checks all restrictions together |

### UI Components (Web)

| File | Type | Purpose |
|------|------|---------|
| `/components/PermitZoneWarning.tsx` | React | Warning banner component |
| `/hooks/usePermitZoneCheck.ts` | Hook | React hook for checking zones |
| `/pages/permit-zone-documents.tsx` | Page | Document upload for permits |

### Admin Routes (Web)

| File | Type | Purpose |
|------|------|---------|
| `/pages/api/admin/check-permit-zones.ts` | API | Admin permit zone checker |
| `/pages/api/admin/review-permit-document.ts` | API | Review uploaded documents |

---

## API Endpoints Summary

### Web API Routes

```
GET  /api/check-permit-zone
     Query: address=<address>
     Returns: zones, parsedAddress

POST /api/mobile/check-parking
     Params: latitude, longitude
     Returns: all parking restrictions

GET  /api/get-zone-geometry
     Query: zoneId=<id>
     Returns: polygon coordinates

GET  /api/neighborhood/permits
     Query: lat=<lat>&lng=<lng>&radius=<miles>
     Returns: building permits near location

POST /api/cron/sync-permit-zones
     Auth: Bearer <CRON_SECRET>
     Syncs 14,000 permit zones

POST /api/upload-permit-document
     Multipart form: ID photo + proof of residency
     Returns: document_id

GET  /api/permit-zone/document-status
     Query: user_id=<id>
     Returns: document verification status
```

### External Data Sources

```
Chicago Data Portal (cityofchicago.org)
├── Parking Permit Zones
│   └── https://data.cityofchicago.org/resource/u9xt-hiju.json
│
├── Parking Tickets
│   └── https://data.cityofchicago.org/resource/rvjx-6vbp.json
│
└── Building Permits
    └── https://data.cityofchicago.org/resource/ydr8-5enu.json
```

---

## Database Tables Related to Autopilot

### User & Subscription Data

```sql
autopilot_subscriptions
├── user_id
├── status (active/cancelled)
├── current_period_start
├── current_period_end
└── authorization_revoked_at

autopilot_settings
├── user_id
├── email_on_ticket_found
├── auto_mail_enabled
├── require_approval
└── allowed_ticket_types (JSON)

autopilot_profiles
├── user_id
├── first_name
├── mailing_address
└── phone
```

### Ticket Tracking

```sql
monitored_plates
├── id
├── user_id
├── plate
├── state
├── status (active/inactive)
└── last_checked_at

detected_tickets
├── id
├── user_id
├── plate
├── ticket_number
├── violation_type
├── amount
├── status (found/needs_approval/mailed/contested/etc)
└── raw_data (JSON - full ticket info)

ticket_audit_log
├── ticket_id
├── user_id
├── action (ticket_found/letter_generated/mailed)
└── details (JSON)
```

---

## Key Libraries & Dependencies

### Address Parsing

```typescript
// /lib/address-parser.ts
parseChicagoAddress(address: string)
// Input:  "1710 S Clinton St"
// Output: { number: 1710, direction: "S", name: "CLINTON", type: "ST" }
```

### Time-Based Restrictions

```typescript
// /lib/permit-zone-time-validator.ts
validatePermitZone(zoneName: string, schedule: string)
parsePermitRestriction(scheduleStr: string)
isPermitCurrentlyRequired(schedule: string)
// Supports: "Mon-Fri 8am-6pm", "24/7", "Mon-Sun 6pm-6am"
```

### Reverse Geocoding

```typescript
// /lib/reverse-geocoder.ts
reverseGeocode(latitude: number, longitude: number)
// Converts GPS → Address
```

---

## Sync Schedule & Automation

### Cron Jobs (Vercel)

| Schedule | Job | File |
|----------|-----|------|
| Every Monday | Check all plates for tickets | `/api/cron/autopilot-check-plates.ts` |
| Every Sunday 2 AM CT | Sync permit zones (14k records) | `/api/cron/sync-permit-zones.ts` |
| Daily | Generate contest letters | `/api/cron/autopilot-generate-letters.ts` |
| As needed | Mail letters via Lob | `/api/cron/autopilot-mail-letters.ts` |

### Manual Commands

```bash
# Sync permit zones immediately
npx ts-node scripts/sync-permit-zones.ts

# Check admin settings
npx ts-node check-hiautopilot-user.js

# Export plates
npx ts-node scripts/export-plates.ts
```

---

## Mobile App Structure (React Native)

### Screens

```
/TicketlessChicagoMobile/src/screens/
├── HomeScreen.tsx           (Main dashboard)
├── MapScreen.tsx            (Parking map view)
├── ProfileScreen.tsx        (User settings)
├── SettingsScreen.tsx       (App settings)
├── LoginScreen.tsx          (Authentication)
├── HistoryScreen.tsx        (Ticket/alert history)
└── OnboardingScreen.tsx     (First-time setup)
```

### Where to Add Permit Zones

1. **HomeScreen** - Add permit zone card at top
2. **MapScreen** - Show permit zones as layers
3. **SettingsScreen** - Toggle permit zone alerts
4. **API Integration** - Use `/api/mobile/check-parking`

---

## Configuration & Environment Variables

### Required for Autopilot

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxx
CHICAGO_DATA_PORTAL_TOKEN=xxxx  # Chicago OpenData token
CRON_SECRET=xxxx                 # Verify cron requests
RESEND_API_KEY (set in environment)  # Email service
LOB_API_KEY (set in environment)     # Physical mail service
```

---

## Testing & Validation

### Real Address Test Cases

```
✓ 1710 S Clinton St      - Zone 2483, Ward 25, Mon-Fri 6am-6pm
✓ 1234 W Diversey Ave    - Loop area permit zone
✓ 900 N Michigan Ave     - Downtown residential zone
✗ 1 E Wacker Dr          - Not in permit zone (commercial)
```

### Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| "No zones found" | Address not in zone | Use GPS instead |
| "Timeout" | Database indexes missing | Check index on street_name |
| "Wrong time" | Timezone issue | API uses Chicago time automatically |
| "Old data" | Sync failed | Run: `npx ts-node scripts/sync-permit-zones.ts` |

---

## Performance Metrics

### API Response Times

| Operation | Time | Notes |
|-----------|------|-------|
| Address parsing | <1ms | Client-side |
| DB lookup | 5-20ms | Indexed query |
| Total API response | 20-50ms | Includes network |
| Permit zone sync | 5-10 min | 14,000 records, weekly |

### Database Indexes

```sql
idx_permit_zones_street_name
idx_permit_zones_status
idx_permit_zones_street_composite (direction, name, type, status)
```

---

## Documentation Files in This Project

1. **AUTOPILOT_INTEGRATION_SUMMARY.md** - Complete integration guide
2. **MOBILE_PERMIT_ZONES_QUICK_START.md** - Quick start for mobile devs
3. **CODEBASE_MAP.md** - This file
4. **AUTOPILOT_UI_REDESIGN.md** - UI/UX documentation
5. **PERMIT_ZONES_README.md** - Detailed permit zones docs

---

## Quick Links

### Autopilot America
- Website: https://autopilotamerica.com
- Admin: https://autopilotamerica.com/admin
- Dashboard: https://autopilotamerica.com/dashboard

### Chicago Data
- Open Data Portal: https://data.cityofchicago.org
- Permit Zones: https://data.cityofchicago.org/Transportation/Parking-Permit-Zones/u9xt-hiju
- Parking Info: https://www.chicago.gov/city/en/depts/cdot/provdrs/parking_and_transportation/svcs/parking_permits.html

### Developer Tools
- Supabase: https://app.supabase.com
- Vercel: https://vercel.com/dashboard
- GitHub: https://github.com

---

## Need Help?

- See existing web implementation: `/components/PermitZoneWarning.tsx`
- Review API docs: `/pages/api/check-permit-zone.ts`
- Check mobile endpoints: `/pages/api/mobile/check-parking.ts`
- Read integration guide: `AUTOPILOT_INTEGRATION_SUMMARY.md`
