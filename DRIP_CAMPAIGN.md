# Email Drip Campaign - Free Alerts Onboarding

## Overview

Automated 3-email sequence for users who sign up for free alerts and opt into marketing emails.

**Goal:** Convert free users to paid Protection subscribers

**Conversion funnel:**
- Day 0: Welcome → Build trust
- Day 3: Proof/Story → Show value
- Day 7: Soft-sell → Direct conversion

---

## Email Sequence

### Email #1: Welcome (Day 0)
**From:** Randy from Autopilot America <randy@autopilotamerica.com>
**Subject:** Welcome to Autopilot America
**Sent:** Immediately when user opts into marketing

**Content:**
- Thanks for signing up
- List what they'll get alerts for (street cleaning, snow bans, stickers)
- "Keep your inbox open" — sets expectation for future emails
- Personal tone from Randy

**Goal:** Build trust and set expectations

---

### Email #2: Proof/Story (Day 3)
**From:** Randy from Autopilot America <randy@autopilotamerica.com>
**Subject:** $20 million in street cleaning tickets last year
**Sent:** 3 days after welcome email

**Content:**
- Chicago wrote $20M in street cleaning tickets last year
- "Every alert you get from us is a $75 ticket you don't pay"
- Brief story about why Randy built this
- Tease: "Full Protection is coming soon"

**Goal:** Prove value and build anticipation

---

### Email #3: Soft-Sell (Day 7)
**From:** Randy from Autopilot America <randy@autopilotamerica.com>
**Subject:** No more lines at the currency exchange
**Sent:** 7 days after welcome email (if user hasn't upgraded)

**Content:**
- "That protection feature I mentioned? It's live."
- Explains automatic sticker renewal service
- Clear benefits (no lines, no stress, no late fees)
- CTA button: "Get Ticket Protection →"

**Goal:** Direct conversion to paid tier

---

## Technical Implementation

### Database Table: `drip_campaign_status`

Tracks email send status for each user:
```sql
- user_id (FK to auth.users)
- email
- welcome_sent / welcome_sent_at
- proof_sent / proof_sent_at
- soft_sell_sent / soft_sell_sent_at
- unsubscribed
- upgraded_to_protection
```

### API Endpoints

**`/api/drip/send-emails` (Cron Job)**
- Runs daily at 9am CT (2pm UTC)
- Checks for pending emails
- Sends appropriate email based on days since welcome
- Marks as sent in database

**`/api/drip/unsubscribe` (POST)**
- Unsubscribes user from marketing emails
- Updates `drip_campaign_status.unsubscribed = true`
- Updates `user_profiles.marketing_consent = false`

### Cron Schedule

**Vercel Cron:** `0 14 * * *` (Daily at 9am CT)

### Integration Points

**Free Alerts Signup** (`/api/alerts/create`)
- When user opts into marketing (`marketingConsent = true`)
- Creates record in `drip_campaign_status`
- User automatically enters drip campaign

**Protection Upgrade**
- When user upgrades to protection
- Marks `upgraded_to_protection = true`
- Skips soft-sell email (already converted!)

---

## Email Copy Style Guide

**Tone:**
- Personal (from Randy, not "Autopilot America team")
- Conversational but professional
- Focus on value, not features
- No aggressive sales tactics

**Structure:**
- Short paragraphs (2-3 sentences max)
- Bullet lists for scanability
- Single clear CTA per email
- Always include unsubscribe link

**Sending:**
- From: Randy from Autopilot America <randy@autopilotamerica.com>
- Subject lines: Benefit-focused, not salesy
- HTML emails with clean, minimal design

---

## Opt-In/Opt-Out

### How Users Opt In
1. Sign up for free alerts at `/alerts/signup`
2. Check "I'd like to get updates or offers from Autopilot America"
3. Automatically added to drip campaign

### How Users Opt Out
- Click "Unsubscribe" link in any email
- Goes to `/unsubscribe?email=user@example.com`
- Confirms unsubscribe with one click
- Marked as `unsubscribed = true`
- No more marketing emails sent

**Note:** Users still receive transactional alerts (street cleaning, snow bans) even if unsubscribed from marketing.

---

## Monitoring & Optimization

### Key Metrics to Track
- **Open rates** (add tracking pixels later)
- **Click-through rates** on CTAs
- **Conversion rate** (free → paid)
- **Unsubscribe rate**
- **Time to conversion** (which email drives the sale?)

### Suggested Improvements
1. **A/B test subject lines** for better open rates
2. **Add tracking pixels** to measure opens
3. **Test different send times** (morning vs evening)
4. **Add Email #4** if soft-sell doesn't convert (case studies, testimonials)
5. **Segment by behavior** (engaged vs non-engaged users)

### Current Limitations
- No open tracking (yet)
- No click tracking (yet)
- Fixed schedule (no behavioral triggers)
- Basic segmentation

---

## Testing

### Manual Test
```bash
# Send test drip emails to yourself
curl -X GET "https://autopilotamerica.com/api/drip/send-emails" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Check Drip Status
```sql
-- See who's in the drip campaign
SELECT
  email,
  welcome_sent,
  proof_sent,
  soft_sell_sent,
  unsubscribed,
  upgraded_to_protection,
  created_at
FROM drip_campaign_status
ORDER BY created_at DESC;
```

### Trigger Specific Email
To test specific emails, temporarily adjust the queries in `/api/drip/send-emails.ts`:
- Change `threeDaysAgo` to `new Date()` for immediate testing
- Change `sevenDaysAgo` to `new Date()` for immediate testing

---

## Deployment

### 1. Run Database Migration
```bash
# Run this SQL in Supabase SQL Editor
database/create-drip-campaign-table.sql
```

### 2. Verify Cron Job
- Check Vercel Dashboard → Cron Jobs
- Ensure `/api/drip/send-emails` runs daily at 9am CT

### 3. Test with Real Signup
1. Sign up for free alerts
2. Check "I'd like to get updates or offers"
3. Verify welcome email arrives immediately
4. Check `drip_campaign_status` table for record

---

## Future Enhancements

**Phase 2:**
- Email open tracking (tracking pixels)
- Click tracking (UTM parameters)
- Behavioral triggers (send Email #2 only if Email #1 was opened)
- Dynamic content (personalize based on user's car type, ward, etc.)

**Phase 3:**
- Advanced segmentation (high-risk ward users get different messaging)
- Win-back campaign for inactive users
- Post-purchase onboarding for Protection users
- Referral email sequence

---

## Support

**Questions about the drip campaign?**
- Technical: Check this doc
- Copy changes: Edit `/api/drip/send-emails.ts`
- Database: Query `drip_campaign_status` table
- Unsubscribes: Check `/api/drip/unsubscribe` logs

**Monitoring:**
- Vercel Logs → `/api/drip/send-emails` to see daily send counts
- Supabase → `drip_campaign_status` table for status
