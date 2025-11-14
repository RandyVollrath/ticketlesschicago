# Stripe Webhook Testing - Quick Start

## 🔐 Fix: Expired API Key

Your Stripe CLI authentication has expired. Here's how to fix it:

### Step 1: Re-authenticate with Stripe
```bash
stripe login
```

This will:
1. Open your browser
2. Ask you to confirm the pairing code
3. Authenticate your CLI with your Stripe account

---

## 🧪 Testing the Webhook

### Option A: Use Stripe CLI (Local Testing)

After logging in, forward webhooks to your production URL:

```bash
# Forward to production (recommended for testing live endpoint)
stripe listen --forward-to https://autopilotamerica.com/api/webhooks/stripe

# Then in another terminal, trigger test events:
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
stripe trigger checkout.session.completed
```

---

### Option B: Use Stripe Dashboard (Easiest)

1. Go to https://dashboard.stripe.com/webhooks
2. Click on your webhook endpoint (`https://autopilotamerica.com/api/webhooks/stripe`)
3. Click **"Send test webhook"** button
4. Select event type (e.g., `customer.subscription.created`)
5. Click **"Send test webhook"**
6. Check the response - should see **200 OK** ✅

---

### Option C: Check Recent Failed Events and Retry

Since you had 11 failed events since Nov 7:

1. Go to https://dashboard.stripe.com/webhooks
2. Click on your webhook endpoint
3. Look at the **"Events"** tab
4. Find any events with ❌ failed status
5. Click **"Resend"** to retry them

This will ensure no missed subscription events!

---

## 🎯 Quick Verification Checklist

After fixing the endpoint, verify it's working:

- [ ] Stripe dashboard shows webhook endpoint as **"Enabled"** (green checkmark)
- [ ] Test webhook returns **200 OK** status
- [ ] No failed events in last 24 hours
- [ ] Environment variable `STRIPE_WEBHOOK_SECRET` matches webhook secret in dashboard

---

## 🔍 Verify Environment Variables

Check that your Vercel deployment has the correct webhook secret:

```bash
# Check what's deployed
vercel env ls

# If webhook secret is missing or wrong, add it:
vercel env add STRIPE_WEBHOOK_SECRET production
# Then paste your webhook secret from: https://dashboard.stripe.com/webhooks
```

Get your webhook signing secret from:
1. https://dashboard.stripe.com/webhooks
2. Click your webhook endpoint
3. Click **"Reveal"** next to "Signing secret"
4. Copy the `whsec_...` value

---

## ✅ Expected Results

When working correctly, you should see:

**Stripe Dashboard:**
- ✅ Endpoint status: Enabled
- ✅ Recent events: All with 200 status code
- ✅ No errors in "Requests had other errors"

**Vercel Logs:**
```bash
vercel logs --follow | grep webhook

# Should show:
# POST /api/webhooks/stripe 200 OK
```

---

## 🆘 Still Having Issues?

### Problem: "api_key_expired" when using Stripe CLI
**Solution:** Run `stripe login` to re-authenticate

### Problem: Webhook returns 404
**Solution:** Already fixed! The endpoint now exists at `/api/webhooks/stripe`

### Problem: Webhook returns 401 Unauthorized
**Solution:** Check that `STRIPE_WEBHOOK_SECRET` environment variable matches dashboard

### Problem: Webhook returns 500 Server Error
**Solution:** Check Vercel logs for the actual error:
```bash
vercel logs | grep -A 10 "POST /api/webhooks/stripe"
```

---

## 📊 Monitor Going Forward

**Daily:** Quick glance at https://dashboard.stripe.com/webhooks
**Weekly:** Send test webhook to verify endpoint still works
**Monthly:** Review all failed events and retry if needed

Your webhook is now fixed and should be receiving events successfully! 🎉
