# Autopilot America & Permit Zones Documentation Index

Welcome! This index helps you navigate all the documentation about Autopilot America data integration and permit zones.

## Quick Navigation

### For Mobile App Developers
**Start here:** [MOBILE_PERMIT_ZONES_QUICK_START.md](./MOBILE_PERMIT_ZONES_QUICK_START.md)
- Quick implementation guide
- Hook + component examples
- Testing addresses

### For Backend/API Developers
**Start here:** [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md)
- Complete integration guide
- Database schemas
- API endpoints
- Data refresh strategy

### For Full Stack Understanding
**Start here:** [CODEBASE_MAP.md](./CODEBASE_MAP.md)
- Project structure
- All relevant files with purposes
- Database tables reference
- Configuration variables

---

## Documentation Files

### 1. AUTOPILOT_INTEGRATION_SUMMARY.md (15 KB)
**Audience:** All developers
**Contents:**
- What Autopilot America does
- Current data integration (3 points)
- Permit zone data structure
- Database schema details
- API endpoints (primary and mobile-optimized)
- How permit zones work
- Step-by-step mobile integration (4 steps)
- Data refresh strategy
- Implementation checklist
- Technical insights
- Troubleshooting guide

**Key Info:**
- Permit zones: 14,000+ records
- Source: Chicago Open Data Portal
- Sync: Weekly (Sunday 2 AM CT)
- API Response: 20-50ms

### 2. MOBILE_PERMIT_ZONES_QUICK_START.md (4.2 KB)
**Audience:** Mobile developers
**Contents:**
- What is a permit zone
- Implementation summary (3 files to create)
- API reference with examples
- Quick integration code snippets
- Key existing files
- Testing addresses
- Common issues & fixes
- Next steps

**Quick Facts:**
- 2 files to create (hook + component)
- Use existing `/api/mobile/check-parking`
- Supports GPS-based lookups
- 5-minute implementation

### 3. CODEBASE_MAP.md (11 KB)
**Audience:** All developers
**Contents:**
- Project structure overview
- Autopilot integration files (plate monitoring, letters, mailing)
- Permit zone system files (DB, API, UI)
- API endpoints summary (7 routes)
- Database tables (user, subscription, ticket tracking)
- Key libraries & dependencies
- Sync schedule & cron jobs
- Mobile app structure
- Configuration variables
- Testing & validation
- Performance metrics

**File Locations:**
- 20+ core files documented
- 10+ database tables explained
- All API routes listed

### 4. CODEBASE_SCHEMA_SUMMARY.md (27 KB)
**Audience:** Database developers
**Contents:**
- Complete schema definitions
- All tables with columns
- Indexes and constraints
- Relationships between tables
- Sample data

### 5. AUTOPILOT_UI_REDESIGN.md (9.3 KB)
**Audience:** UI/UX developers
**Contents:**
- Landing page design
- Settings page design
- Dashboard design
- Color system
- Typography
- Component patterns
- User flows

---

## Understanding the System

### Autopilot America
Autopilot America is a service that:
1. **Free Tier** - Monitors license plates for new parking tickets
2. **Paid Tier** ($24/year) - Auto-generates contest letters and mails them to Chicago Department of Finance
3. **Win Rate** - Approximately 54% of contested tickets win

### Permit Zones
Chicago has 14,000+ residential permit parking zones that:
- Require valid parking permits during restricted hours (usually Mon-Fri 6am-6pm)
- Are specific to street addresses and sometimes odd/even sides
- Include restriction schedules that vary by zone

### Integration Flow
```
Chicago Data Portal (Public API)
    ↓
Supabase PostgreSQL Database
    ↓
Next.js API Routes
    ↓
Web App (React) + Mobile App (React Native)
```

---

## File Structure

```
ticketless-chicago/
├── Documentation (You are here)
│   ├── AUTOPILOT_DOCS_INDEX.md (this file)
│   ├── AUTOPILOT_INTEGRATION_SUMMARY.md
│   ├── MOBILE_PERMIT_ZONES_QUICK_START.md
│   ├── CODEBASE_MAP.md
│   ├── CODEBASE_SCHEMA_SUMMARY.md
│   └── AUTOPILOT_UI_REDESIGN.md
│
├── Web App (Next.js)
│   ├── pages/
│   │   ├── api/check-permit-zone.ts
│   │   ├── api/mobile/check-parking.ts
│   │   ├── api/cron/autopilot-check-plates.ts
│   │   ├── api/cron/sync-permit-zones.ts
│   │   └── api/cron/autopilot-generate-letters.ts
│   ├── components/
│   │   ├── PermitZoneWarning.tsx
│   │   └── PermitZoneDocumentUpload.tsx
│   ├── hooks/
│   │   └── usePermitZoneCheck.ts
│   └── lib/
│       ├── address-parser.ts
│       ├── permit-zone-time-validator.ts
│       ├── unified-parking-checker.ts
│       └── permit-zone-messaging.ts
│
├── Mobile App (React Native)
│   └── src/
│       ├── screens/
│       │   ├── HomeScreen.tsx
│       │   └── MapScreen.tsx
│       └── hooks/
│           └── (usePermitZoneCheck.ts - to be created)
│
└── Database
    ├── parking_permit_zones (14k+ records)
    ├── parking_permit_zones_sync (metadata)
    ├── monitored_plates (user plates)
    ├── detected_tickets (found tickets)
    ├── autopilot_subscriptions (user subscriptions)
    └── autopilot_settings (user config)
```

---

## Key APIs

### REST Endpoints

| Method | Path | Purpose | Mobile Ready |
|--------|------|---------|--------------|
| GET | `/api/check-permit-zone?address=...` | Address lookup | No (use GPS) |
| GET/POST | `/api/mobile/check-parking?lat=...&lng=...` | GPS lookup | Yes |
| POST | `/api/cron/sync-permit-zones` | Sync zones weekly | Internal |
| GET | `/api/neighborhood/permits?lat=...&lng=...` | Building permits | Yes |

### External APIs

| Source | URL | Data | Update Frequency |
|--------|-----|------|------------------|
| Chicago Data Portal | data.cityofchicago.org | Parking Permit Zones | Weekly |
| Chicago Data Portal | data.cityofchicago.org | Parking Tickets | Real-time |
| Chicago Data Portal | data.cityofchicago.org | Building Permits | Real-time |

---

## Common Tasks

### "I want to add permit zones to the mobile app"
1. Read: [MOBILE_PERMIT_ZONES_QUICK_START.md](./MOBILE_PERMIT_ZONES_QUICK_START.md)
2. Create: Hook file + Component file
3. Test: With GPS coordinates
4. Reference: Web component example at `/components/PermitZoneWarning.tsx`

### "I need to understand the permit zone data structure"
1. Read: [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md) - Section 2
2. Reference: [CODEBASE_SCHEMA_SUMMARY.md](./CODEBASE_SCHEMA_SUMMARY.md) - DB schema

### "I need to know all API endpoints"
1. Read: [CODEBASE_MAP.md](./CODEBASE_MAP.md) - Section "API Endpoints Summary"
2. Reference: [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md) - Section 3

### "I need to debug permit zone sync failures"
1. Read: [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md) - Section 12
2. Check: `SELECT * FROM parking_permit_zones_sync ORDER BY created_at DESC LIMIT 1;`

### "I need to understand the web app implementation"
1. Reference: `/components/PermitZoneWarning.tsx`
2. Reference: `/hooks/usePermitZoneCheck.ts`
3. Read: [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md) - Section 4-5

---

## Performance Notes

### API Response Times
- Address parsing: < 1ms
- Database lookup: 5-20ms
- Total API response: 20-50ms
- Permit zone sync: 5-10 minutes

### Database Optimizations
- Indexes on `street_name`, `status`, and composite `(direction, name, type, status)`
- 14,000+ permit zones cached locally
- Weekly sync prevents API overload

---

## Testing

### Real Chicago Addresses in Permit Zones
- 1710 S Clinton St - Zone 2483, Ward 25
- 1234 W Diversey Ave - Loop area
- 900 N Michigan Ave - Downtown

### Invalid Test Cases
- 1 E Wacker Dr - NOT in permit zone (commercial)

---

## Support & Questions

### Documentation Issues
If docs are unclear or missing:
1. Check [CODEBASE_MAP.md](./CODEBASE_MAP.md) - "Need Help?" section
2. Review existing implementations:
   - Web: `/components/PermitZoneWarning.tsx`
   - API: `/pages/api/mobile/check-parking.ts`

### Technical Questions
- API details: See [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md) Section 3
- Database schema: See [CODEBASE_SCHEMA_SUMMARY.md](./CODEBASE_SCHEMA_SUMMARY.md)
- Implementation: See [MOBILE_PERMIT_ZONES_QUICK_START.md](./MOBILE_PERMIT_ZONES_QUICK_START.md)

---

## Document Versions

Last Updated: January 21, 2025

| File | Size | Updated | Version |
|------|------|---------|---------|
| AUTOPILOT_INTEGRATION_SUMMARY.md | 15 KB | Jan 21 | v1.0 |
| MOBILE_PERMIT_ZONES_QUICK_START.md | 4.2 KB | Jan 21 | v1.0 |
| CODEBASE_MAP.md | 11 KB | Jan 21 | v1.0 |
| CODEBASE_SCHEMA_SUMMARY.md | 27 KB | Pre | v1.0 |
| AUTOPILOT_UI_REDESIGN.md | 9.3 KB | Pre | v1.0 |

---

## Next Steps

1. **Choose your role:**
   - Mobile developer? → Read [MOBILE_PERMIT_ZONES_QUICK_START.md](./MOBILE_PERMIT_ZONES_QUICK_START.md)
   - Backend developer? → Read [AUTOPILOT_INTEGRATION_SUMMARY.md](./AUTOPILOT_INTEGRATION_SUMMARY.md)
   - Full stack? → Read [CODEBASE_MAP.md](./CODEBASE_MAP.md)

2. **Explore the codebase** using file paths from the docs

3. **Ask questions** about anything unclear

4. **Implement** your feature using the provided guides

---

Happy coding!
