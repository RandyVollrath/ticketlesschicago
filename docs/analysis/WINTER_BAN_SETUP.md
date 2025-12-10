# Winter Overnight Parking Ban Notification System

## Overview
This system sends notifications to users on Chicago's Winter Overnight Parking Ban streets (3am-7am, December 1 - April 1).

**Notification Strategy:**
1. **November 30th**: Annual reminder to all opted-in users on affected streets
2. **New Signups**: Immediate notification for users who sign up during winter season (Dec 1 - Apr 1) if their address is on a ban street

## Setup Instructions

### 1. Run Database Migration

Execute the migration file against your Supabase database:

```bash
# Using Supabase CLI
supabase db push database-migrations/005-add-winter-overnight-parking-ban.sql

# Or manually in Supabase SQL Editor
# Copy and paste the contents of database-migrations/005-add-winter-overnight-parking-ban.sql
```

This creates:
- `winter_overnight_parking_ban_streets` table (22 street segments from FOIA data)
- `user_winter_ban_notifications` table (tracks who's been notified each season)
- `notify_winter_ban` column on `user_profiles` (user preference)
- Helper function `is_address_on_winter_ban_street()`

### 2. Enable User Opt-In

Users need to opt-in to winter ban notifications. Add a checkbox to your user settings:

```typescript
// In your settings/preferences page
<input
  type="checkbox"
  checked={profile.notify_winter_ban}
  onChange={(e) => updateProfile({ notify_winter_ban: e.target.checked })}
/>
<label>Notify me about Winter Overnight Parking Ban (if applicable)</label>
```

### 3. Schedule November 30th Notifications

Set up a cron job or scheduled task to run on **November 30th at 9:00 AM**:

**Option A: Vercel Cron (Recommended)**
```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/send-winter-ban-notifications",
      "schedule": "0 9 30 11 *"
    }
  ]
}
```

**Option B: GitHub Actions**
```yaml
# .github/workflows/winter-ban-notifications.yml
name: Send Winter Ban Notifications
on:
  schedule:
    - cron: '0 9 30 11 *'  # Nov 30 at 9am UTC
  workflow_dispatch:  # Allow manual trigger

jobs:
  send-notifications:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger notification endpoint
        run: |
          curl -X POST https://ticketlessamerica.com/api/send-winter-ban-notifications
```

**Option C: Manual Trigger**
```bash
# Run manually on November 30th
curl -X POST https://ticketlessamerica.com/api/send-winter-ban-notifications
```

### 4. Add to User Signup Flow

Integrate winter ban checking into your user registration/address update flow:

```typescript
// In your signup or address update handler
import { notifyNewUserAboutWinterBan } from '../lib/winter-ban-notifications';

async function handleUserSignup(userData) {
  // ... existing signup logic ...

  // Check and notify about winter ban if applicable
  await notifyNewUserAboutWinterBan(
    user.id,
    userData.address,
    userData.email,
    userData.phone,
    userData.firstName
  );
}
```

## Testing

### Test Address Matching
```bash
node scripts/test-winter-ban-matching.js
```

This verifies that addresses are correctly matched to winter ban streets.

### Test Notification Sending (Dry Run)
```bash
# Set up test user in database with:
# - notify_winter_ban = true
# - home_address_full = "123 Madison Ave, Chicago, IL"

# Then trigger the endpoint
curl -X POST http://localhost:3000/api/send-winter-ban-notifications
```

## Data Files

- **Source Data**: `data/winter-overnight-parking-ban-streets.json`
  - 22 street segments from City of Chicago FOIA request
  - Contains street name, from/to locations
  - Last updated: 2025-10-08

## How It Works

### November 30th Annual Notification
1. Cron job triggers `/api/send-winter-ban-notifications` on Nov 30
2. Fetches all users with `notify_winter_ban = true`
3. Checks if their address matches any winter ban street
4. Sends SMS + Email if:
   - Address is on a ban street
   - User hasn't been notified this season yet
5. Logs notification in `user_winter_ban_notifications`

### New Signup During Winter
1. User signs up or updates address during Dec 1 - Apr 1
2. System calls `notifyNewUserAboutWinterBan()`
3. Checks if address is on ban street
4. Sends immediate notification if matched
5. Logs notification to prevent duplicates

## Notification Content

**SMS (160 chars):**
```
❄️ WINTER PARKING BAN starts TOMORROW (Dec 1-Apr 1). NO parking on MADISON AVE 3am-7am daily.
Violation = $150+ tow + $60 ticket. Move your car! [link]
```

**Email:**
- Subject: "❄️ Winter Overnight Parking Ban Starts Tomorrow (Dec 1)"
- Includes ban details, penalties, what to do
- Personalized with user's first name and matched street

## Future Enhancements

### 2-Inch Snow Ban (Not Yet Implemented)
The city has a separate 2-inch snow ban on ~500 miles of streets. To add:

1. **Get Data**: File FOIA request for 2-inch ban street list
2. **Weather Integration**: Add weather API (NWS, Weather.gov) to detect 2+ inch snow
3. **Event-Based Alerts**: Send notifications when 2+ inches forecasted
4. **Different Table**: Create `two_inch_snow_ban_streets` table

## Troubleshooting

**No notifications sent?**
- Check that users have `notify_winter_ban = true`
- Verify addresses are populated in `home_address_full`
- Ensure street names match format in database (uppercase, with/without periods)

**Users notified multiple times?**
- Check `user_winter_ban_notifications` table for duplicate entries
- Ensure `UNIQUE(user_id, notification_year)` constraint exists

**Address matching issues?**
- Run `scripts/test-winter-ban-matching.js`
- Address matching is simple string containment - may need geocoding for accuracy

## Questions?

Contact: ticketlessamerica@gmail.com
