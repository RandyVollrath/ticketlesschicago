# Protection Purchase Failure - Incident Report

**Date**: November 23, 2025, 10:05 AM UTC
**Affected User**: countluigivampa@gmail.com (Randy Vollrath)
**Severity**: CRITICAL - Paying customer could not access account
**Status**: ✅ FIXED

---

## What Happened

A customer purchased Ticket Protection ($12/month) but the webhook failed to create their complete profile. The user could not login because critical data was missing from their account.

---

## Root Cause

**The Stripe webhook code tried to insert a `permit_zones` column that doesn't exist in the database.**

The webhook **DID deliver successfully** (Stripe dashboard shows 0% failure rate). However, the webhook code at **3 locations** tried to set a `permit_zones` field:

1. **Line 243** (new user path): `permit_zones: hasValue(metadata.permitZones) ? JSON.parse(metadata.permitZones) : null`
2. **Line 409** (existing auth user path): Same code
3. **Lines 604-606** (existing profile update path): Same code

When the database INSERT/UPDATE tried to execute, it failed with:
```
Could not find the 'permit_zones' column of 'user_profiles' in the schema cache
```

The error was logged (line 248, 415) but execution continued, so the profile was **never created** with Protection data.

---

## Timeline

- **10:05:07 UTC** - Customer completed Stripe checkout ✅
- **10:05:22 UTC** - Stripe created `checkout.session.completed` event ✅
- **10:05:22 UTC** - Webhook delivered to server ✅
- **10:05:23.520 UTC** - Webhook created auth user ✅
- **10:05:23.572 UTC** - Webhook tried to create profile → **FAILED** ❌ (permit_zones column doesn't exist)
- **10:05:23 UTC** - Error logged, execution continued, but profile incomplete
- **10:09:00 UTC** - Manual intervention: Magic link sent
- **10:15:00 UTC** - Manual fix: Database updated with correct data
- **10:20:00 UTC** - Root cause identified: `permit_zones` column doesn't exist
- **10:25:00 UTC** - Bug fixed: Removed all 3 references to `permit_zones`

---

## What Was Missing Before Fix

When the webhook profile INSERT failed, the user got an incomplete account:

| Field | Expected | Actual | Impact |
|-------|----------|--------|--------|
| `stripe_customer_id` | `cus_TTXEZMpOf0B0Nd` | `NULL` | **CRITICAL**: Cannot charge for renewals! |
| `is_paid` | `true` | `NULL` | User not flagged as paying customer |
| `first_name` | `Randall` | `NULL` | Personalization broken |
| `last_name` | `Vollrath` | `NULL` | Personalization broken |
| `street_address` | `938 W Montana St` | `NULL` | Cannot process permit renewals |
| `has_permit_zone` | `true` | `false` | Permit features disabled |
| `permit_requested` | `true` | `false` | Permit renewals won't trigger |
| User Consent | Record created | **NONE** | Legal compliance missing |
| Audit Log | Record created | **NONE** | No payment tracking |
| Welcome Email | Sent with magic link | **NOT SENT** | Customer cannot login |

---

## The Fix

Removed all 3 references to the non-existent `permit_zones` column:

**File**: `pages/api/stripe-webhook.ts`

```typescript
// BEFORE (line 243, 409)
permit_zones: hasValue(metadata.permitZones) ? JSON.parse(metadata.permitZones) : null,

// AFTER
// NOTE: permit_zones column does not exist in database - removed to prevent insert failure

// BEFORE (lines 604-606)
if (hasValue(metadata.permitZones)) {
  updateData.permit_zones = JSON.parse(metadata.permitZones);
}

// AFTER
// NOTE: permit_zones column does not exist in database - removed to prevent update failure
```

**Commit**: Removed non-existent `permit_zones` column from all webhook code paths

---

## Manual Fix Applied to Affected User

```sql
UPDATE user_profiles SET
  stripe_customer_id = 'cus_TTXEZMpOf0B0Nd',
  is_paid = true,
  first_name = 'Randall',
  last_name = 'Vollrath',
  zip_code = '60614',
  street_address = '938 W Montana St',
  has_permit_zone = true,
  permit_requested = true,
  vehicle_type = 'P'
WHERE user_id = '733f9c7e-271a-4690-8904-944fccb7d3f8';

-- Also created consent record manually
-- Also sent magic link email manually via Resend
```

---

## Why This Wasn't Caught Earlier

1. **No test coverage** for Protection purchase flow with permit zones
2. **Silent failure** - Error was logged but didn't alert anyone
3. **No monitoring** for failed profile creations after successful payments
4. **Testing with repeat users** - As the user noted: "maybe it's a repeat test user issue"
   - Repeat test users may have had profiles from previous attempts
   - The existing profile path doesn't fail (just skips creation)
   - Only NEW users with permit zones would hit this bug

---

## Prevention Steps

### 1. ✅ DONE: Remove Non-Existent Column

Removed all references to `permit_zones` column from webhook code.

### 2. ⏳ TODO: Add Webhook Success Monitoring

Even if the webhook delivers, we need to verify the profile was created correctly:

**File**: `pages/api/cron/verify-protection-purchases.ts` (NEW)

```typescript
// Runs every hour
// Finds users with Stripe subscriptions but missing stripe_customer_id
// Sends alerts for any found
// Optionally auto-fixes by fetching session from Stripe and updating database
```

### 3. ⏳ TODO: Add Webhook Completion Tracking

Add a database flag to track if webhook fully completed:

```sql
ALTER TABLE user_profiles ADD COLUMN webhook_completed BOOLEAN DEFAULT false;
```

Webhook sets this to `true` at the end. Cron job finds users where it's still `false` after 5 minutes.

### 4. ⏳ TODO: Add Immediate Alerts for Failed Profile Creation

In webhook error handler:

```typescript
if (profileError) {
  console.error('Error creating user profile:', profileError);

  // IMMEDIATE ALERT - Don't wait for cron job
  await resend.emails.send({
    from: 'Alerts <alerts@autopilotamerica.com>',
    to: 'randyvollrath@gmail.com',
    subject: '🚨 Protection Purchase - Profile Creation Failed',
    text: `Session: ${session.id}\nEmail: ${email}\nError: ${profileError.message}`
  });

  // Return error response so Stripe retries
  return res.status(500).json({ error: 'Profile creation failed' });
}
```

### 5. ⏳ TODO: Add Schema Validation Before Deploy

Create a test that validates webhook code against actual database schema:

**File**: `tests/webhook-schema-validation.test.ts`

```typescript
// Fetches actual database schema
// Validates all INSERT/UPDATE statements in webhook code
// Fails if any column doesn't exist
```

### 6. ✅ DONE: Use Fresh Test Users

As the user noted: "i'll try to use users i don't use as often"

Repeat test users mask bugs because:
- They may have profiles from previous attempts
- The "existing profile" code path is different
- Bugs only show up for truly new users

---

## Testing Checklist

- [ ] Complete a test Protection purchase with a NEW email (never used before)
- [ ] Verify webhook creates profile with all fields
- [ ] Verify stripe_customer_id is saved
- [ ] Verify welcome email is sent
- [ ] Verify consent and audit log records are created
- [ ] Test with permit zone enabled
- [ ] Test with permit zone disabled
- [ ] Monitor Vercel logs during test to confirm no errors
- [ ] Verify user can login immediately after purchase

---

## Related Files

- `/pages/api/webhooks/stripe.ts` - Main webhook handler (re-exports stripe-webhook.ts)
- `/pages/api/stripe-webhook.ts` - Actual webhook logic (lines 145-817 for Protection)
  - **Fixed lines: 243, 409, 604-606**
- `/scripts/check-user-emergency.js` - Emergency diagnostic tool (created during incident)
- `/NOTIFICATION_TESTING_GUIDE.md` - Full notification system documentation

---

## Stripe Configuration

**Webhook Endpoint**: `https://www.autopilotamerica.com/api/webhooks/stripe`
**Status**: Enabled ✅
**Delivery Success Rate**: 100% (0% failures)
**Events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `payment_intent.succeeded`

**Event Details (this incident)**:
- Event ID: `evt_1SWaAYPSdzV8LIEx6Ka23yQg`
- Session ID: `cs_live_a1tsiWyTiY3DlxDYjXGZvKrdEHQ9A3892T2EpPzyJPKqWuBrr1NJHxQpGa`
- Customer ID: `cus_TTXEZMpOf0B0Nd`
- Subscription ID: `sub_1SWaATPSdzV8LIExqxzs8FqH`
- Delivered: **YES** ✅ (contrary to initial assessment)

---

## Impact Assessment

**Revenue Impact**: None (customer was charged correctly)
**Customer Experience**: **CRITICAL** - Customer could not access paid service
**Data Integrity**: Multiple critical fields missing until manual fix
**Legal Compliance**: Consent not logged (fixed manually)

**If not caught**:
- Customer would have been charged monthly but received no service
- Renewals would fail (no stripe_customer_id to charge)
- Permit renewals would fail (no address/zone data)
- Legal exposure (no consent record)

---

## Action Items

1. ✅ **DONE**: Manually fixed affected user
2. ✅ **DONE**: Fixed webhook code (removed non-existent permit_zones column)
3. ⏳ **TODO**: Add immediate alerts for failed profile creation
4. ⏳ **TODO**: Add hourly cron job to verify Protection purchases completed correctly
5. ⏳ **TODO**: Add schema validation test before deploy
6. ⏳ **TODO**: Add comprehensive end-to-end tests for Protection purchase
7. ⏳ **TODO**: Test Protection purchase with fresh test user
8. ⏳ **TODO**: Add database migration to create permit_zones column (if needed) OR remove from metadata

---

## Lessons Learned

1. **Webhook delivery ≠ webhook success** - Need to monitor completion, not just delivery
2. **Schema validation is critical** - Code referenced a column that doesn't exist
3. **Silent failures are dangerous** - Error was logged but didn't alert anyone
4. **Repeat test users mask bugs** - Always test with fresh users for critical flows
5. **Manual intervention tools are vital** - Having scripts ready saved hours during the incident
6. **Database schema and code must stay in sync** - Either create the column or remove the code

---

## Follow-up Questions

1. ✅ **ANSWERED**: Why did webhook fail? → Code bug, not delivery failure
2. ⏳ **TODO**: Are there other affected users? Need to run query for users with subscriptions but no `stripe_customer_id`
3. ⏳ **TODO**: Should we add `permit_zones` column to database? Or remove from all code?
4. ⏳ **TODO**: What other columns in webhook code don't exist in database?

---

**Document Created**: November 23, 2025
**Author**: Claude (AI Assistant)
**Reviewed By**: Randy Vollrath
**Status**: Incident resolved, prevention measures in progress
