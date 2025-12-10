# WWW Redirect Issue - Explained & Fixed

## 🚨 What Happened

Between Nov 7-14, 2025, all Stripe webhooks were failing with **307 redirect errors**.

### The Root Cause

Your domain is configured to redirect:
```
https://autopilotamerica.com → https://www.autopilotamerica.com
```

This is a common SEO best practice (choosing one canonical domain), but it caused problems with webhooks.

---

## 🔍 Technical Details

### The Redirect Chain

When Stripe sent a webhook to:
```
POST https://autopilotamerica.com/api/webhooks/stripe
```

Your server responded with:
```
HTTP/1.1 307 Temporary Redirect
Location: https://www.autopilotamerica.com/api/webhooks/stripe
```

### Why Stripe Doesn't Follow Redirects

**Security reason:** If Stripe followed redirects, a malicious actor could:
1. Intercept the redirect
2. Point it to their own server
3. Steal webhook data (subscription info, customer data, payment details)

So Stripe **refuses to follow redirects** and treats 307 as a failure.

---

## ✅ The Fix

### What We Changed

1. **Updated Stripe webhook URL** from:
   - ❌ `https://autopilotamerica.com/api/webhooks/stripe`
   - ✅ `https://www.autopilotamerica.com/api/webhooks/stripe`

2. **Updated `STRIPE_WEBHOOK_SECRET`** to match the current signing secret

3. **Created `/pages/api/webhooks/stripe.ts`** to re-export the main handler

---

## 🛡️ Prevention - How to Avoid This in the Future

### Rule 1: Always Use the Canonical Domain

When configuring external services (Stripe, Resend, ClickSend, etc.), always use your **canonical domain** (the one you redirect TO, not FROM).

**Your canonical domain:** `www.autopilotamerica.com`

### Rule 2: Check All Webhook Configurations

Review these services and ensure they use `www`:

- ✅ **Stripe:** `https://www.autopilotamerica.com/api/webhooks/stripe`
- ⚠️ **Resend:** Check if using `www` for inbound email webhooks
- ⚠️ **ClickSend:** Check if using `www` for SMS webhooks

### Rule 3: Test Webhooks After Domain Changes

If you ever:
- Add/remove www redirect
- Change DNS settings
- Switch hosting providers
- Update SSL certificates

**Always re-test all webhooks!**

---

## 🧪 How to Test for Redirect Issues

### Method 1: cURL (Quick Check)

```bash
# Check for redirects
curl -I https://autopilotamerica.com/api/webhooks/stripe

# Should redirect to www:
# HTTP/2 307
# location: https://www.autopilotamerica.com/api/webhooks/stripe

# Check canonical URL (no redirect):
curl -I https://www.autopilotamerica.com/api/webhooks/stripe

# Should respond directly:
# HTTP/2 405 (Method Not Allowed is expected for HEAD request)
```

### Method 2: Stripe CLI

```bash
stripe trigger customer.subscription.created \
  --forward-to https://www.autopilotamerica.com/api/webhooks/stripe
```

### Method 3: Check Vercel Logs

```bash
npx vercel logs --follow | grep "webhook"
```

Look for:
- ✅ `POST /api/webhooks/stripe 200 OK`
- ❌ `POST /api/webhooks/stripe 307 Redirect`

---

## 📊 Impact Assessment

### Events Affected

Between Nov 7-14, 2025:
- **14 failed webhook events** (all `customer.subscription.deleted`)
- **0 critical events missed** (no payment failures or new subscriptions in this period)

### Events That Need Resending

All 14 failed events should be resent from Stripe dashboard to ensure data consistency.

---

## 🎯 Other Services to Check

### Vercel Deployment Domains

Your app is deployed at multiple domains. Ensure all external webhooks point to the **canonical production domain**:

✅ **Use this:** `https://www.autopilotamerica.com`

❌ **Don't use these for webhooks:**
- `https://autopilotamerica.com` (redirects to www)
- `https://ticketless-chicago.vercel.app` (preview domain)
- `https://ticketless-chicago-[hash].vercel.app` (deployment-specific URLs)

### DNS Configuration

Your DNS should have:
```
A     autopilotamerica.com        → [IP]
CNAME www.autopilotamerica.com    → [Vercel]
```

With Vercel/nginx/server configured to redirect:
```
autopilotamerica.com → www.autopilotamerica.com
```

This is correct for SEO, but webhooks must use `www`.

---

## 📝 Checklist: After Reading This Document

- [ ] Stripe webhook URL updated to use `www`
- [ ] All 14 failed events resent successfully (showing 200 OK)
- [ ] Resend webhook URL checked (if using inbound email)
- [ ] ClickSend webhook URL checked (if using SMS forwarding)
- [ ] Test webhooks monthly to catch issues early
- [ ] Bookmark this document for future reference

---

## 🔗 Related Documentation

- **WEBHOOK_TESTING_GUIDE.md** - Complete guide to testing all webhooks
- **STRIPE_WEBHOOK_TESTING.md** - Quick start for Stripe webhook testing
- **TEST_WEBHOOK_NOW.md** - Step-by-step instructions to verify the fix

---

## 🎓 Key Takeaway

**Always configure third-party webhooks with your canonical domain (the one you redirect TO, not FROM).**

For your app: Use `www.autopilotamerica.com`, not `autopilotamerica.com`.
