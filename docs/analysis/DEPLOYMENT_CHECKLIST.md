# Deployment Checklist

## ⚠️ CRITICAL: After EVERY deployment that touches payments/webhooks

**DO NOT SKIP THIS. CUSTOMERS ARE PAYING MONEY.**

### 1. Deploy
```bash
git push
```

### 2. Wait for Vercel deployment (2-3 minutes)

### 3. Test Protection Purchase IMMEDIATELY

Run this script:
```bash
./scripts/test-protection-purchase.sh
```

Or manually:
1. Go to https://autopilotamerica.com/protection
2. Use email: `test-TIMESTAMP@gmail.com` (use current timestamp)
3. Use test card: `4242 4242 4242 4242`, exp `12/34`, CVC `123`
4. Complete purchase
5. Verify you received email within 30 seconds
6. Run verification:
   ```bash
   node scripts/check-user-complete.js test-TIMESTAMP@gmail.com
   ```

### 4. Expected Results

```
✅ Profile created
✅ Stripe customer ID saved
✅ Consents created (1)
✅ Audit logs created (1)
✅ Email received
```

### 5. If ANY check fails

```bash
# IMMEDIATELY REVERT
git revert HEAD
git push
```

Alert Randy that the deployment is broken.

## Files That Require This Test

If you changed ANY of these files, you MUST test:

- `pages/api/stripe-webhook.ts` ← CRITICAL
- `pages/protection.tsx`
- `lib/audit-logger.ts`
- Any database migrations affecting `user_profiles`, `user_consents`, or `audit_logs`

## Why This Matters

**This is not optional. This is people's money.**

If Protection purchases don't work:
- Customers pay and can't access their account
- Legal liability (no consent records)
- No audit trail
- Customer support nightmare
- Refunds + lost customers
- Reputation damage

**Test EVERY time. No exceptions.**
