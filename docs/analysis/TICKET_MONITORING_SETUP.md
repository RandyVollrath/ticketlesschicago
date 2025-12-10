# Ticket Monitoring System Setup

Automatically monitors Chicago parking tickets for your users using their license plate + last name.

## How It Works

1. **User Data**: We collect `license_plate`, `license_state`, `last_name` from user profiles
2. **Playwright Automation**: Headless browser navigates to chipay.chicago.gov and performs lookups
3. **Diff Detection**: Compare new results against stored snapshots to detect new tickets
4. **Alerts**: Notify users via email/SMS when new tickets appear
5. **Proof Storage**: Keep timestamped HTML snapshots for dispute evidence

## Setup Steps

### 1. Create Database Tables

```bash
psql $POSTGRES_URL < database/create-ticket-monitoring-tables.sql
```

This creates:
- `ticket_snapshots` - stores all detected tickets
- `ticket_check_log` - tracks monitoring runs
- `ticket_alerts` - records sent alerts

### 2. Install Playwright Browsers

```bash
npx playwright install chromium
```

### 3. Test the Lookup Form (CRITICAL FIRST STEP)

Before running the monitoring system, you MUST identify the correct form selectors:

```bash
node scripts/test-ticket-lookup.js
```

This will:
- Open the Chicago portal in a browser
- Take screenshots
- Save the HTML
- List all input fields and buttons
- Keep browser open for 30 seconds so you can inspect

**Then update `lib/ticket-monitor.ts` with the correct selectors!**

Look for these in the debug output:
- License plate input field
- State dropdown (if separate)
- Last name input field
- Submit button
- Results table/rows

### 4. Update Selectors in `lib/ticket-monitor.ts`

Replace the placeholder selectors:

```typescript
// Update these based on test-ticket-lookup.js output:
const plateSelector = 'input[name="licensePlate"]'; // ← REPLACE
const stateSelector = 'select[name="state"]'; // ← REPLACE
const lastNameSelector = 'input[name="lastName"]'; // ← REPLACE
const submitSelector = 'button[type="submit"]'; // ← REPLACE

// And the results parsing:
const ticketRows = await page.$$('.ticket-row'); // ← REPLACE
```

### 5. Test with a Single User

```bash
node -e "
const { checkUserTickets } = require('./lib/ticket-monitor');
checkUserTickets({
  user_id: 'test-user-id',
  license_plate: 'ABC123',
  license_state: 'IL',
  last_name: 'Smith',
  email: 'test@example.com'
}).then(() => console.log('Done'));
"
```

### 6. Add Cron Job to `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/check-user-tickets",
      "schedule": "0 */3 * * *"
    }
  ]
}
```

This runs every 3 hours. Adjust based on your needs:
- Free tier users: Every 6-12 hours
- Pro/Protection tier: Every 1-3 hours

### 7. Add Ticket Monitoring to Settings Page

Let users opt in/out and view their monitored tickets.

## Important Considerations

### Rate Limiting
- Wait 5 seconds between each user check (hardcoded in `lib/ticket-monitor.ts`)
- With 1000 users, a full run takes ~1.5 hours
- Adjust based on Chicago's terms of service

### Privacy & Legal
- Users must opt-in (already required for the service)
- Store HTML snapshots for dispute proof
- Use encrypted columns for sensitive data:
  ```sql
  ALTER TABLE ticket_snapshots
  ALTER COLUMN license_plate TYPE TEXT
  USING pgp_sym_encrypt(license_plate, current_setting('app.encryption_key'));
  ```

### Error Handling
- Check `ticket_check_log` table for failed runs
- Monitor for changes to Chicago's portal (selectors break)
- Alert yourself if success rate drops below 90%

### Monitoring the Monitor
```sql
-- Check recent runs
SELECT
  checked_at,
  COUNT(*) as checks,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  SUM(tickets_found) as total_tickets,
  SUM(new_tickets) as new_tickets
FROM ticket_check_log
WHERE checked_at > NOW() - INTERVAL '24 hours'
GROUP BY checked_at
ORDER BY checked_at DESC;
```

## User-Facing Features

### Show Tickets in Settings/Dashboard

```typescript
// Fetch user's tickets
const { data: tickets } = await supabase
  .from('ticket_snapshots')
  .select('*')
  .eq('user_id', userId)
  .order('issue_date', { ascending: false });
```

### Alert Users of New Tickets

In `lib/ticket-monitor.ts`, uncomment the alert function:

```typescript
// Send email
await sendEmail({
  to: user.email,
  subject: '⚠️ New Parking Ticket Detected',
  body: `We found a new ticket for ${license_plate}...`
});
```

### Contest Flow Integration

When users click "Contest This Ticket", pre-fill the ticket info from the snapshot.

## Troubleshooting

### "Can't find selector"
- Re-run `scripts/test-ticket-lookup.js`
- Check if Chicago updated their portal
- Update selectors in `lib/ticket-monitor.ts`

### "Browser launch failed"
- Install chromium: `npx playwright install chromium`
- Check Vercel supports Playwright (may need custom runtime)
- Consider using Browserless.io as a service

### "Rate limited by Chicago"
- Increase delay between checks (currently 5 seconds)
- Reduce check frequency (every 6 hours instead of 3)
- Add randomized delays

### "Tickets not parsing correctly"
- Chicago changed their HTML structure
- Update the ticket row parsing logic
- Check `raw_html` column in database to debug

## Next Steps

1. Run test script to get selectors
2. Update `lib/ticket-monitor.ts` with correct selectors
3. Test with one user
4. Deploy cron job
5. Add UI to show users their tickets
6. Build alert notification system
