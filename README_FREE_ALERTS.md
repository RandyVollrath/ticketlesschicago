# Free Alerts Migration - Implementation Guide

## Overview

This document explains the free alerts feature, how to configure it, and how to test the different flows.

## Feature Flags

The application now supports two feature flags that control the UX:

### `NEXT_PUBLIC_FREE_ALERTS`
- **Default**: `true`
- **Purpose**: Enables the free alerts flow on the homepage
- **When true**: Users see the new Hero with "Get Free Alerts" CTA, /alerts/signup is accessible
- **When false**: Homepage shows the old paid-first experience

### `NEXT_PUBLIC_PROTECTION_WAITLIST`
- **Default**: `true`
- **Purpose**: Controls whether /protection shows waitlist or checkout
- **When true**: /protection page shows email capture form for waitlist
- **When false**: /protection page shows Stripe checkout for $12/mo or $120/yr

### `DRY_RUN`
- **Default**: `false`
- **Purpose**: Prevents actual email/SMS from being sent in admin manual-alerts tool
- **When true**: API calls are logged but no messages are sent

## Configuration

Add these to your `.env.local`:

```bash
# Feature Flags
NEXT_PUBLIC_FREE_ALERTS=true
NEXT_PUBLIC_PROTECTION_WAITLIST=true
DRY_RUN=false

# Stripe Price IDs (required when PROTECTION_WAITLIST=false)
STRIPE_PROTECTION_MONTHLY_PRICE_ID=price_xxxxx
STRIPE_PROTECTION_ANNUAL_PRICE_ID=price_xxxxx
```

## Database Setup

Run these SQL migrations in your Supabase dashboard (SQL Editor):

1. **Create protection_waitlist table**:
   ```bash
   sql/create_protection_waitlist_table.sql
   ```

2. **Add has_protection column to user_profiles**:
   ```bash
   sql/add_has_protection_to_profiles.sql
   ```

## Routes & Pages

### Public Routes

| Route | Description | Requires Auth |
|-------|-------------|---------------|
| `/` | Homepage with Hero and free alerts messaging | No |
| `/alerts/signup` | Free signup form | No |
| `/alerts/success` | Confirmation page after free signup | No |
| `/protection` | Premium tier explainer + waitlist/checkout | No |
| `/settings` | User account settings and preferences | Yes |
| `/login` | Login page | No |

### Admin Routes

| Route | Description | Requires Auth | Requires Role |
|-------|-------------|---------------|---------------|
| `/admin/manual-alerts` | Send test alerts to users | Yes | admin |

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/alerts/create` | POST | Create free user account + vehicle |
| `/api/protection/waitlist` | POST | Add email to Protection waitlist |
| `/api/protection/checkout` | POST | Create Stripe checkout session for Protection |
| `/api/admin/send-alert` | POST | Send manual alert (admin only) |

## Testing Flows

### Flow 1: Free Alerts Signup

1. Navigate to `/`
2. Click "Get Free Alerts" button
3. Fill out signup form:
   - First name, Last name
   - Email, Phone
   - License plate
   - Street address, ZIP
4. Submit form
5. Should redirect to `/alerts/success`
6. User account is created in Supabase
7. Vehicle is added to `vehicles` table
8. Profile created in `user_profiles` with `has_protection=false`

**Expected Database State:**
- `auth.users`: New user created
- `user_profiles`: New profile with `has_protection=false`
- `vehicles`: One vehicle with `subscription_status='active'`

### Flow 2: Protection Waitlist (PROTECTION_WAITLIST=true)

1. Navigate to `/protection`
2. Should see "Join the Waitlist" form
3. Enter email address
4. Submit form
5. Email saved to `protection_waitlist` table
6. Success message displayed

**Expected Database State:**
- `protection_waitlist`: New row with email and optional user_id

### Flow 3: Protection Checkout (PROTECTION_WAITLIST=false)

1. Set `NEXT_PUBLIC_PROTECTION_WAITLIST=false` in `.env.local`
2. Create Stripe products/prices:
   - Monthly: $12/mo
   - Annual: $120/yr
3. Add price IDs to `.env.local`
4. Navigate to `/protection`
5. Should see pricing toggle and checkout button
6. Select monthly or annual
7. Click "Get Protected"
8. Should redirect to Stripe Checkout
9. On successful payment, Stripe webhook sets `has_protection=true`

**Expected Database State (after webhook):**
- `user_profiles`: `has_protection=true` for the user

### Flow 4: Admin Manual Alerts

1. Set user role to `admin` in `user_profiles` table
2. Navigate to `/admin/manual-alerts`
3. Select alert type (email/SMS/both)
4. Enter recipient emails (comma or newline separated)
5. Enter alert message
6. Click "Send Alerts"
7. Review send log

**With `DRY_RUN=true`:**
- No actual messages sent
- Console logs show what would be sent

**With `DRY_RUN=false`:**
- Real emails/SMS sent via Resend + ClickSend

## Vehicle Limits

| Plan | Vehicle Limit | Enforced Where |
|------|---------------|----------------|
| Free | 1 vehicle | `/api/alerts/create` (hard check) |
| Protection | Unlimited | No limit enforced |

When a free user tries to add a 2nd vehicle, they should see an upgrade prompt in `/settings`.

## Telemetry Events

The following events are logged to console (can be piped to PostHog):

- `hero_cta_clicked`: User clicks primary or secondary CTA
- `free_signup_submitted`: User submits free signup form
- `free_signup_success`: Free signup completed successfully
- `waitlist_joined`: User joins Protection waitlist
- `protection_checkout_started`: User starts Protection checkout
- `protection_checkout_success`: Protection payment successful
- `upgrade_card_clicked`: User clicks upgrade card in settings

## Common Issues & Solutions

### Issue: "Failed to create or find user"
**Solution**: User already exists. The API handles this gracefully and continues with existing user.

### Issue: "Free plan allows 1 vehicle"
**Solution**: User trying to add 2nd vehicle on free plan. Direct them to `/protection` to upgrade.

### Issue: "Stripe price ID not configured"
**Solution**: Add `STRIPE_PROTECTION_MONTHLY_PRICE_ID` and `STRIPE_PROTECTION_ANNUAL_PRICE_ID` to `.env.local`

### Issue: Manual alerts not sending
**Solution**: Check `DRY_RUN` flag. If false, verify ClickSend + Resend API keys are configured.

## Stripe Product Setup

When ready to launch Protection (PROTECTION_WAITLIST=false):

1. Go to Stripe Dashboard → Products
2. Create product: "Ticket Protection Monthly"
   - Price: $12/month, recurring
   - Copy price ID → `STRIPE_PROTECTION_MONTHLY_PRICE_ID`
3. Create product: "Ticket Protection Annual"
   - Price: $120/year, recurring
   - Copy price ID → `STRIPE_PROTECTION_ANNUAL_PRICE_ID`
4. Set up webhook for `checkout.session.completed` event
5. On webhook, set `user_profiles.has_protection=true`

## Rollback Plan

If you need to revert to the old paid-first model:

1. Set `NEXT_PUBLIC_FREE_ALERTS=false`
2. Rename `pages/index-old-backup.tsx` → `pages/index.tsx`
3. Restart the dev server

The old paid signup flow will be restored.

## File Structure

```
pages/
  index.tsx                          # Homepage (new free alerts version)
  index-old-backup.tsx               # Old paid-first homepage (backup)
  alerts/
    signup.tsx                       # Free signup form
    success.tsx                      # Free signup confirmation
  protection.tsx                     # Premium tier page
  admin/
    manual-alerts.tsx                # Admin tool for test messages
  api/
    alerts/
      create.ts                      # Free signup API
    protection/
      waitlist.ts                    # Waitlist API
      checkout.ts                    # Stripe checkout API
    admin/
      send-alert.ts                  # Manual alert API

components/
  Hero.tsx                           # New hero with free alerts copy
  UpgradeCard.tsx                    # Premium upsell card

sql/
  create_protection_waitlist_table.sql
  add_has_protection_to_profiles.sql

.env.local                           # Feature flags + config
README_FREE_ALERTS.md                # This file
```

## Contact & Support

For questions about this implementation:
- Check console logs for detailed error messages
- Review Supabase logs for database issues
- Check Stripe dashboard for payment issues
- Email support@ticketlesschicago.com