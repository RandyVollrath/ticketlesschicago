# 2Captcha Setup for Ticket Monitoring

The ticket monitoring system uses 2captcha.com to solve hCaptcha on Chicago's payment portal.

## Setup Steps

### 1. Get Your 2Captcha API Key

If you already have a 2captcha account:
1. Log in to https://2captcha.com/
2. Go to your account dashboard
3. Copy your API key

If you need to create an account:
1. Sign up at https://2captcha.com/auth/register
2. Add funds ($3 minimum, solves ~1000 captchas)
3. Copy your API key from the dashboard

### 2. Add API Key to Environment Variables

Add to `.env.local`:
```bash
CAPTCHA_API_KEY=your_2captcha_api_key_here
```

Add to Vercel environment variables (if deploying):
```bash
vercel env add CAPTCHA_API_KEY
```

### 3. Test the Integration

Run the ticket lookup for a single user:
```bash
node -e "
const { lookupTickets } = require('./lib/ticket-monitor');
lookupTickets('CW22016', 'IL', 'Vollrath')
  .then(result => console.log('Success:', result))
  .catch(err => console.error('Error:', err));
"
```

## Costs

### Per-Captcha Cost
- **2captcha**: $3 per 1,000 solves = $0.003 per solve

### Per-User Cost (Monthly)
- 3 checks/day: 90 checks/month = **$0.27/month**
- 6 checks/day: 180 checks/month = **$0.54/month**

### Total Monthly Cost Examples
- 100 users × 3 checks/day = **$27/month**
- 1000 users × 3 checks/day = **$270/month**
- 1000 users × 6 checks/day = **$540/month**

## Reducing Costs

### Smart Checking Strategy
Don't check all users every time. Implement tiered checking:

```typescript
// In checkAllUserTickets()
const users = await supabaseAdmin
  .from('user_profiles')
  .select('*, ticket_snapshots(count)')
  .not('license_plate', 'is', null);

for (const user of users) {
  let checksPerDay;

  // New users (first 7 days): Check daily
  if (isNewUser(user)) {
    checksPerDay = 1;
  }
  // Users with active tickets: Check frequently
  else if (user.ticket_snapshots_count > 0) {
    checksPerDay = 3;
  }
  // Users with no tickets: Check weekly
  else {
    checksPerDay = 0.14; // ~1x per week
  }

  if (shouldCheckUser(user, checksPerDay)) {
    await checkUserTickets(user);
  }
}
```

This can reduce costs by **80-90%**.

## Monitoring Costs

Check your 2captcha balance:
```bash
curl "https://2captcha.com/res.php?key=YOUR_API_KEY&action=getbalance"
```

Set up alerts when balance is low:
- 2captcha dashboard → Settings → Balance alerts

## Alternative Services

If 2captcha is expensive, consider:
- **Anti-Captcha**: $2 per 1,000 solves (25% cheaper)
- **CapSolver**: $0.80 per 1,000 solves (75% cheaper)

Update `lib/ticket-monitor.ts` to use a different service if needed.

## Troubleshooting

### "Captcha solving failed"
- Check your API key is correct
- Check your 2captcha balance has funds
- Check 2captcha service status: https://2captcha.com/status

### "Timeout while solving captcha"
- hCaptcha can take 10-60 seconds to solve
- Increase timeout in `lookupTickets()` if needed

### "Button still disabled after captcha solve"
- The captcha token might not be injected correctly
- Check the console logs for the token injection
- Try clicking the captcha iframe directly before injecting

## Notes

- Each captcha solve takes 10-60 seconds
- Failed solves are not charged
- 2captcha has a 99.9% success rate for hCaptcha
- Tokens are valid for 120 seconds after solving
