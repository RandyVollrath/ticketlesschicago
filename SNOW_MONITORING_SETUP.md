# 2-Inch Snow Ban Monitoring & Notification System

## Overview
This system automatically monitors Chicago weather for 2+ inches of snow and sends real-time notifications to affected users.

**How It Works:**
1. **Hourly Weather Checks**: During winter (Nov 1 - Apr 1), system checks National Weather Service API every hour
2. **Snow Detection**: When 2+ inches of snow is detected in forecast or on the ground, creates a snow event
3. **Automatic Notifications**: Sends immediate SMS + Email alerts to all opted-in users
4. **One Notification Per Event**: Users only get notified once per snow event (no spam)

## Setup Instructions

### 1. Run Database Migrations

Execute both migration files in your Supabase SQL Editor:

```sql
-- First, the snow event tracking migration
-- Copy/paste: database-migrations/006-add-snow-event-tracking.sql
```

This creates:
- `snow_events` table (tracks detected snow events)
- `user_snow_ban_notifications` table (tracks who's been notified)
- `notify_snow_ban` column on `user_profiles` (user opt-in preference)
- Helper functions for snow event management

### 2. Configure Environment Variables

Add to your `.env.local` (if not already set):

```bash
# App URL for API calls
NEXT_PUBLIC_APP_URL=https://ticketlessamerica.com

# Email (Resend)
RESEND_API_KEY=your_resend_key
RESEND_FROM=TicketLess America <noreply@ticketlessamerica.com>

# SMS (ClickSend)
CLICKSEND_USERNAME=your_username
CLICKSEND_API_KEY=your_api_key
SMS_SENDER=TicketLess

# Database (Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Schedule Hourly Weather Monitoring

**Option A: Vercel Cron (Recommended)**

Update `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/monitor-snow",
      "schedule": "0 * 1 11,0,1,2,3 *"
    }
  ]
}
```

This runs every hour during winter months (Nov, Dec, Jan, Feb, Mar).

**Option B: External Cron Service**

Use a service like cron-job.org or EasyCron:
- URL: `https://ticketlessamerica.com/api/cron/monitor-snow`
- Schedule: `0 * * * *` (every hour)
- Active: Nov 1 - Apr 1 only

**Option C: GitHub Actions**

```yaml
# .github/workflows/monitor-snow.yml
name: Monitor Snow Conditions
on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:

jobs:
  check-snow:
    runs-on: ubuntu-latest
    steps:
      - name: Check snow conditions
        run: |
          curl -X POST https://ticketlessamerica.com/api/cron/monitor-snow
```

### 4. Enable User Opt-In

Add checkbox to user settings/preferences:

```typescript
// In your settings page
<input
  type="checkbox"
  checked={profile.notify_snow_ban}
  onChange={(e) => updateProfile({ notify_snow_ban: e.target.checked })}
/>
<label>Notify me when 2+ inches of snow triggers parking ban</label>
```

### 5. Add 2-Inch Ban Street Data (TODO)

Currently, the system notifies ALL opted-in users. Once you receive the FOIA data:

1. Create `two_inch_snow_ban_streets` table
2. Import the ~500 miles of street data
3. Update notification logic to filter users by street

## Testing

### Test Weather API Connection

```bash
node scripts/test-weather-api.js
```

Expected output:
- ✅ Connects to NWS API
- ✅ Gets Chicago grid point
- ✅ Fetches current conditions
- ✅ Retrieves forecast
- ✅ Parses snow amounts

### Test Snow Detection (Manual)

```bash
# Check current weather and create snow event if applicable
curl http://localhost:3000/api/weather/check-snow

# Or in production
curl https://ticketlessamerica.com/api/weather/check-snow
```

### Test Notification Sending (Dry Run)

```bash
# First, manually create a test snow event in Supabase:
INSERT INTO snow_events (event_date, snow_amount_inches, is_active, two_inch_ban_triggered)
VALUES (CURRENT_DATE, 3.5, true, false);

# Then trigger notifications
curl -X POST http://localhost:3000/api/send-snow-ban-notifications
```

### Test Full Monitoring Flow

```bash
curl -X POST http://localhost:3000/api/cron/monitor-snow
```

This simulates the hourly cron job.

## How The System Works

### Weather Monitoring Flow

```
Every Hour (during winter)
    ↓
Check NWS API for Chicago weather
    ↓
Parse forecast for snow mentions
    ↓
Extract snow amount from forecast text
    ↓
If >= 2 inches:
    ↓
    Create/update snow_event record
    ↓
    If not yet notified:
        ↓
        Send notifications to opted-in users
        ↓
        Mark event as notified
```

### Data Sources

**National Weather Service (NWS) API:**
- **URL**: https://api.weather.gov
- **Cost**: FREE - No API key required
- **Coverage**: Official US government weather data
- **Update Frequency**: Hourly forecasts, updated every ~30 minutes
- **Reliability**: Highly reliable, same data used by weather apps
- **Chicago Station**: KORD (O'Hare International Airport)

**Why NWS?**
- Free and no rate limits for reasonable use
- Most accurate source for US weather
- Provides detailed text forecasts with snow amounts
- Official government source

### Snow Detection Logic

The system parses forecast text for patterns like:
- "Snow accumulation of 2 to 4 inches"
- "New snow accumulation around 3 inches"
- "Total snowfall of 6 to 10 inches"

It extracts the **maximum** value from ranges (e.g., "2 to 4 inches" = 4 inches).

### Notification Rules

1. **Opt-In Required**: Users must enable `notify_snow_ban`
2. **One Per Event**: Users notified once per snow event (deduplication via `user_snow_ban_notifications` table)
3. **Active Events Only**: Only notifies for active snow events (is_active = true)
4. **2+ Inches**: Only triggers when snow >= 2.0 inches
5. **Dual Channel**: Sends both SMS + Email if contact info available

## Files Created

### Database
- `database-migrations/006-add-snow-event-tracking.sql` - Snow event schema

### Services
- `lib/weather-service.ts` - NWS API integration

### API Endpoints
- `pages/api/weather/check-snow.ts` - Check weather and create snow events
- `pages/api/send-snow-ban-notifications.ts` - Send notifications to users
- `pages/api/cron/monitor-snow.ts` - Hourly monitoring job

### Scripts
- `scripts/test-weather-api.js` - Test weather API connection

### Documentation
- `SNOW_MONITORING_SETUP.md` - This file

## Notification Content

### SMS (160 chars)
```
🚨 SNOW BAN ACTIVE! 3.5" snow detected. MOVE YOUR CAR from your street NOW!
Violation = $150+ tow + $60 ticket. Ban active until streets cleared. [link]
```

### Email
- Subject: "🚨 2-Inch Snow Ban ACTIVE - Move Your Car (3.5" snow)"
- Includes:
  - Snow amount
  - Immediate action required
  - Penalty information
  - When ban will be lifted
  - Link to official city info

## Monitoring & Logs

### Check Recent Snow Events

```sql
SELECT * FROM snow_events
ORDER BY event_date DESC
LIMIT 10;
```

### Check Who Was Notified

```sql
SELECT
  u.email,
  s.event_date,
  s.snow_amount_inches,
  n.sent_at,
  n.channels
FROM user_snow_ban_notifications n
JOIN users u ON u.id = n.user_id
JOIN snow_events s ON s.id = n.snow_event_id
ORDER BY n.sent_at DESC;
```

### Check Active Snow Events

```sql
SELECT * FROM snow_events
WHERE is_active = true
AND snow_amount_inches >= 2.0
ORDER BY event_date DESC;
```

## Troubleshooting

### Weather API Not Working
- Check NWS API status: https://www.weather.gov/
- Verify User-Agent header is set correctly
- Check network connectivity
- Run `node scripts/test-weather-api.js`

### No Notifications Sent
- Verify users have `notify_snow_ban = true`
- Check that snow event exists with `is_active = true` and `snow_amount_inches >= 2.0`
- Ensure event hasn't already been notified (`two_inch_ban_triggered = false`)
- Check SMS/Email credentials in environment variables

### Duplicate Notifications
- Check for duplicate snow events on same date
- Verify UNIQUE constraint exists on `(user_id, snow_event_id)`
- Check cron job isn't running multiple times per hour

### Snow Amount Parsing Issues
- NWS forecast text format may vary
- Check `metadata` field in `snow_events` for raw forecast text
- May need to update regex patterns in `parseSnowAmount()` function

## Future Enhancements

### Add 2-Inch Ban Street Filtering
Once you get FOIA data for the ~500 miles of 2-inch ban streets:

1. **Create table:**
```sql
CREATE TABLE two_inch_snow_ban_streets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  street_name TEXT NOT NULL,
  from_location TEXT,
  to_location TEXT
);
```

2. **Update notification logic** to only notify users whose address matches a 2-inch ban street

3. **Add street info to notifications** (e.g., "Move your car from Kedzie Ave")

### Add Snow Accumulation Tracking
- Track actual snow accumulation from NWS observations
- Update events with real-time snow amounts
- Auto-deactivate events when snow clears

### Add User Preferences
- Let users choose notification timing (immediate vs. forecast-based)
- Add quiet hours (don't notify between midnight-6am)
- Choose notification channels (SMS only, Email only, or Both)

### Add Dashboard View
- Show current active snow events
- Display forecast for next 7 days
- Show notification history

## Cost Estimates

**NWS API**: Free
**Notifications** (per snow event, assuming 1000 users):
- SMS: 1000 × $0.02 = $20
- Email: 1000 × $0.0001 = $0.10
- **Total per event**: ~$20

Typical winter: 5-10 major snow events = $100-200/season

## Support

Questions? Contact: ticketlessamerica@gmail.com

## License

Internal use only - Ticketless America
