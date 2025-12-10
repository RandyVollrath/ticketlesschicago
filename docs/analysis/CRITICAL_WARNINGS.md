# ⚠️ CRITICAL WARNINGS - READ BEFORE USING

## 1. Winter Overnight Parking Ban (3am-7am)

### ⚠️ LIMITED STREET DATA
**YOU ONLY HAVE 22 STREET SEGMENTS** from your FOIA request, NOT the full 107 miles of winter ban streets.

**Current Coverage:**
- Madison Ave (Canal to Des Plaines)
- State Street (600 S to 2200 S)
- Cermak Road, MLK Dr, Cottage Grove, etc.
- **Total: 22 segments** (see `data/winter-overnight-parking-ban-streets.json`)

**What This Means:**
- Many winter ban streets are MISSING from the database
- Users on those missing streets WON'T be notified
- Users might get notifications for similar street names (false positives)

**Address Matching is BASIC:**
- Just checks if street name appears in address (e.g., "STATE STREET" in "123 State Street")
- Could match "State St" when user is on "State Line Rd" (false positive)
- Won't match if user wrote "State St" but database has "STATE STREET" (false negative)

**Preview System:**
- **Nov 16 at 9am**: Email sent to `ticketlessamerica@gmail.com`
- Shows exactly who will be notified on Nov 30
- Review this list carefully before Nov 30!

**How to Get Full Data:**
- File FOIA request for complete 107-mile winter ban street list
- See `WINTER_BAN_SETUP.md` for exact wording

---

## 2. 2-Inch Snow Ban

### ⚠️ ADMIN-ONLY ALERTS ENABLED
**YOU DO NOT HAVE THE 2-INCH SNOW BAN STREET LIST**

The city website says there are ~500 miles of streets subject to the 2-inch snow ban, but you don't have this data yet.

**Current Implementation:**
- ✅ Weather monitoring ENABLED (detects 2+ inch snow every hour, Nov-Apr)
- ✅ Database tracking works
- ✅ **Admin email alerts** - you get notified when 2+ inches detected
- ❌ **User notifications DISABLED** - no street data to filter by
- ❌ Users will NOT be notified (only you will be)

**What Happens Now:**
1. System checks weather hourly (Nov 1 - Apr 30)
2. When 2+ inches detected:
   - Creates snow event in database
   - Emails **ticketlessamerica@gmail.com** with snow details
   - Shows you what WOULD happen if you had street data
3. You can manually post updates or wait for FOIA data

**When You Get FOIA Street Data:**
1. Import streets to database
2. Update notification code to filter by street address
3. Enable user notifications
4. System will then notify affected users automatically

**FOIA Request:**
Submit at https://chicago.nextrequest.com/:

```
Subject: FOIA Request - Two-Inch Snow Parking Ban Street List

Under the Illinois Freedom of Information Act (5 ILCS 140), I am requesting a complete list of all streets subject to the Two-Inch Snow Parking Ban.

Specifically:
1. Machine-readable file (CSV, Excel, GeoJSON, or shapefile) of all ~500 miles of 2-inch snow ban streets
2. Street names, address ranges (from/to), and geographic boundaries

Please provide in electronic format.
```

**Timing:**
- 2-inch ban can trigger ANY TIME there's 2+ inches of snow (even summer technically)
- Practically happens Nov-Apr in Chicago
- Weather monitoring runs hourly during Nov-Mar

---

## 3. National Weather Service API

### ✅ This is REAL and FREE
**NWS API does NOT require an API key** - it's a free US government service.

**Verification:**
- Official docs: https://www.weather.gov/documentation/services-web-api
- Test it yourself: `node scripts/test-weather-api.js`
- Used by many weather apps and services

**How it works:**
- Gets Chicago forecast from O'Hare Airport station (KORD)
- Parses text forecasts for snow mentions
- Extracts snow amounts from phrases like "2 to 4 inches of snow"

**Reliability:**
- Same data used by weather.gov and NOAA
- Updates every ~30 minutes
- Highly reliable (government source)

---

## 4. Scheduled Jobs Summary

### Current Vercel Cron Schedule:

| Date | Time | Endpoint | Purpose |
|------|------|----------|---------|
| **Nov 16** | 9am | `/api/admin/preview-winter-ban-list` | Email preview list to admin |
| **Nov 30** | 9am | `/api/send-winter-ban-notifications` | Send winter ban notifications |
| **Nov-Apr** | Every hour | `/api/cron/monitor-snow` | Check for 2+ inch snow → email admin ✅ |

**Snow Monitoring Status:**
- ✅ **ENABLED** - Checks weather every hour from November through April
- ✅ **Admin alerts** - You get emailed when 2+ inches detected
- ❌ **User notifications** - Disabled until you have street data

---

## 5. User Opt-In Fields

### Database Columns:
- `user_profiles.notify_winter_ban` - Winter overnight ban (3am-7am)
- `user_profiles.notify_snow_ban` - 2-inch snow ban (DO NOT ENABLE YET)

### UI Recommendations:

**Winter Ban:**
```
☑ Winter Overnight Parking Ban Notifications
  Receive reminder on Nov 30 if you park on an affected street
  (3am-7am ban, Dec 1 - Apr 1)
```

**Snow Ban (hide until street data available):**
```
⚠️ Coming Soon: 2-Inch Snow Ban Notifications
  We're working on adding real-time snow ban alerts
```

---

## 6. Testing Checklist

### Before Going Live:

**Winter Ban:**
- [ ] Run migration: `005-add-winter-overnight-parking-ban.sql`
- [ ] Test address matching: `node scripts/test-winter-ban-matching.js`
- [ ] Wait for Nov 16 preview email
- [ ] Review the list of users who will be notified
- [ ] Verify addresses look correct
- [ ] If good, let Nov 30 notification run automatically
- [ ] If bad, disable the cron before Nov 30

**Snow Ban:**
- [ ] Run migration: `006-add-snow-event-tracking.sql` ✅
- [ ] Test weather API: `node scripts/test-weather-api.js`
- [ ] Get FOIA street data
- [ ] Import street data to database
- [ ] Update notification code to filter by street
- [ ] Test with sample addresses
- [ ] Enable cron job

---

## 7. Cost Warnings

### Per Notification Event:

Assuming 1000 users:
- SMS: 1000 × $0.02 = **$20**
- Email: 1000 × $0.0001 = **$0.10**
- **Total: ~$20 per event**

### Annual Costs (estimated):

**Winter Ban:**
- 1 notification per season (Nov 30)
- Cost: ~$20/year

**Snow Ban:**
- 5-10 major snow events per winter
- Cost: ~$100-200/season

**Street Cleaning (existing):**
- ~25 notifications per user per year
- Cost: Already budgeted

---

## 8. What Works vs What Doesn't

### ✅ Currently Working:

1. **Winter overnight ban detection** (limited to 22 streets)
2. **Preview email system** (sends Nov 16)
3. **Weather API integration** (detects snow accurately)
4. **Snow event tracking** (records 2+ inch events)
5. **Basic address matching** (simple string search)

### ❌ Not Working / Incomplete:

1. **Full winter ban street coverage** (only 22 of 107 miles)
2. **Accurate address geocoding** (could have false positives)
3. **2-inch snow ban street filtering** (no street data at all)
4. **Street name variations** (e.g., "Ave" vs "Avenue", "St" vs "Street")

### 🔨 Needs Manual Intervention:

1. Review Nov 16 preview email before Nov 30
2. Get FOIA data for 2-inch ban streets
3. Consider geocoding service for accurate address matching
4. Get complete 107-mile winter ban street list

---

## 9. Emergency Controls

### Disable All Winter/Snow Notifications:

**Option 1: Remove from vercel.json**
```json
// Comment out these lines:
// {
//   "path": "/api/admin/preview-winter-ban-list",
//   "schedule": "0 9 16 11 *"
// },
// {
//   "path": "/api/send-winter-ban-notifications",
//   "schedule": "0 9 30 11 *"
// },
```

**Option 2: Database flag**
```sql
UPDATE user_profiles SET notify_winter_ban = false;
UPDATE user_profiles SET notify_snow_ban = false;
```

**Option 3: Block at endpoint level**
Add to `/api/send-winter-ban-notifications.ts`:
```typescript
return res.status(200).json({
  success: false,
  message: 'Notifications disabled by admin'
});
```

---

## 10. Recommendations

### Before Nov 16, 2025:

1. ✅ Deploy the preview system
2. ✅ Let it send preview email Nov 16
3. ⏳ Review the email carefully
4. ⏳ Make decision: enable or disable Nov 30 notifications

### After Nov 30, 2025:

1. Evaluate accuracy of notifications sent
2. Collect user feedback
3. File FOIA for complete winter ban street list
4. File FOIA for 2-inch snow ban street list
5. Consider professional geocoding service (Google Maps API, Mapbox)

### Long Term:

1. Use geocoding to accurately match addresses to street segments
2. Import complete city street data
3. Add address validation during signup
4. Consider city partnership for official street data access

---

## Questions?

Contact: ticketlessamerica@gmail.com
