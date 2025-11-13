# Webhook Testing & Monitoring Guide

## 🚨 What Went Wrong with the Stripe Webhook?

### The Problem
Stripe was sending webhook events to `/api/webhooks/stripe` but your app only had the handler at `/api/stripe-webhook.ts`. This caused:
- 11 failed requests since Nov 7, 2025
- Stripe receiving 404 errors instead of 200 status codes
- Potential missed payment events (subscription updates, charges, etc.)

### The Root Cause
**Path mismatch between Stripe configuration and your Next.js API structure:**
- Stripe endpoint configured: `https://autopilotamerica.com/api/webhooks/stripe`
- Actual file location: `/pages/api/stripe-webhook.ts` (maps to `/api/stripe-webhook`)

### The Fix
Created `/pages/api/webhooks/stripe.ts` that re-exports the main handler:
```typescript
export { default } from '../stripe-webhook';
export { config } from '../stripe-webhook';
```

---

## 🎯 Your Active Webhooks

### 1. **Stripe Webhooks** (`/api/webhooks/stripe`)
**Purpose**: Handle subscription events, payment updates, customer updates
**Critical Events**:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `checkout.session.completed`

**Stripe Dashboard**: https://dashboard.stripe.com/webhooks
**Testing**: https://dashboard.stripe.com/test/webhooks

---

### 2. **Resend Incoming Email** (`/api/webhooks/resend-incoming-email`)
**Purpose**: Receive forwarded emails for document uploads (utility bills, etc.)
**Critical for**: Permit zone users sending proof of residency via email

**Resend Dashboard**: https://resend.com/webhooks
**Testing**: Send test email to your configured inbound address

---

### 3. **ClickSend Incoming SMS** (`/api/webhooks/clicksend-incoming-sms`)
**Purpose**: Receive forwarded SMS/MMS for document uploads
**Critical for**: Users texting photos of documents

**ClickSend Dashboard**: https://dashboard.clicksend.com/
**Testing**: Send test SMS/MMS to your ClickSend number

---

### 4. **Vercel Cron Jobs** (Not webhooks, but similar failure modes)
**Purpose**: Automated daily tasks
- Ticket lookups
- Renewal checks
- Protection alerts
- Street cleaning notifications

**Vercel Dashboard**: https://vercel.com/[your-account]/ticketless-chicago/settings/cron-jobs

---

## 🛡️ Preventing Webhook Failures

### Rule 1: Always Match Webhook URLs to File Paths
**Next.js API Routes Pattern**:
```
File: /pages/api/webhooks/stripe.ts
URL:  /api/webhooks/stripe ✅

File: /pages/api/stripe-webhook.ts
URL:  /api/stripe-webhook ✅

File: /api/webhooks/stripe.ts
URL:  INVALID (Next.js only looks in /pages/api) ❌
```

### Rule 2: Always Export `config` for Special Requirements
```typescript
export const config = {
  api: {
    bodyParser: false, // Required for Stripe signature verification
  },
};
```

### Rule 3: Always Verify Signatures
```typescript
// Stripe example
const signature = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  rawBody,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

### Rule 4: Return Early for Invalid Requests
```typescript
// Return 200 for valid but unhandled events
if (!['customer.subscription.created', 'invoice.payment_succeeded'].includes(event.type)) {
  return res.status(200).json({ received: true });
}
```

### Rule 5: Always Log Webhook Errors
```typescript
try {
  // Process webhook
} catch (error) {
  console.error('Webhook error:', error);
  await logAuditEvent({
    actionType: 'webhook_error',
    actionDetails: { error: error.message },
  });
  return res.status(500).json({ error: 'Webhook processing failed' });
}
```

---

## 🧪 Testing Strategy

### Level 1: Local Testing (Development)
```bash
# 1. Install Stripe CLI
brew install stripe/stripe-cli/stripe

# 2. Login to Stripe
stripe login

# 3. Forward webhooks to localhost
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# 4. Trigger test events
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
stripe trigger checkout.session.completed
```

### Level 2: Staging/Preview Testing (Vercel)
```bash
# Deploy to preview
vercel

# Update webhook URLs to preview URL
# https://your-app-git-branch.vercel.app/api/webhooks/stripe

# Trigger events from Stripe dashboard > Developers > Webhooks > Send test webhook
```

### Level 3: Production Monitoring (Live)

#### A. Set Up Webhook Monitoring Dashboard
Create `/pages/admin/webhooks.tsx`:
```typescript
// Show recent webhook events from audit logs
// Filter by actionType: 'webhook_received', 'webhook_error'
// Display: timestamp, event type, status, error message
```

#### B. Monitor Stripe Dashboard Daily
- Visit: https://dashboard.stripe.com/webhooks
- Check for "Requests had other errors" (like your 11 failures)
- Review failed events and retry them if needed

#### C. Set Up Alerts
Create a daily cron job to check webhook health:
```typescript
// /pages/api/cron/check-webhook-health.ts
// Query audit logs for webhook errors in last 24 hours
// If > 5 errors, send alert email to admin
```

---

## 📊 Webhook Health Checklist (Weekly Review)

### Stripe Webhooks
- [ ] Visit https://dashboard.stripe.com/webhooks
- [ ] Confirm endpoint shows "Enabled" with green checkmark
- [ ] Review "Events" tab for any failed deliveries
- [ ] Check that webhook secret matches `STRIPE_WEBHOOK_SECRET` in Vercel env vars
- [ ] Test with: `stripe trigger customer.subscription.created`

### Resend Email Webhooks
- [ ] Visit https://resend.com/webhooks
- [ ] Confirm endpoint is active
- [ ] Send test email to your inbound address
- [ ] Verify document upload works

### ClickSend SMS Webhooks
- [ ] Visit https://dashboard.clicksend.com/
- [ ] Confirm SMS number is configured for forwarding
- [ ] Send test MMS with image
- [ ] Verify document upload works

### Vercel Deployment
- [ ] Confirm all webhook endpoints return 200 for valid requests
- [ ] Check Vercel logs for webhook errors: `vercel logs --follow`
- [ ] Review audit logs in database for webhook failures

---

## 🔧 Testing Each Webhook

### 1. Test Stripe Webhook

#### Option A: Stripe CLI (Recommended for development)
```bash
# Forward to local
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger specific event
stripe trigger customer.subscription.created
```

#### Option B: Stripe Dashboard (Production)
1. Go to https://dashboard.stripe.com/test/webhooks
2. Click your webhook endpoint
3. Click "Send test webhook"
4. Select event type (e.g., `customer.subscription.created`)
5. Click "Send test webhook"
6. Verify you see 200 response

#### Option C: Create Real Test Event
```bash
# Create test subscription
stripe customers create --email test@example.com
stripe subscriptions create \
  --customer cus_xxx \
  --items[0][price]=price_xxx
```

---

### 2. Test Resend Email Webhook

#### Create Test Inbound Email
```bash
# Send email to your configured address
# From: your-email@gmail.com
# To: uploads@autopilotamerica.com (or your configured address)
# Subject: Test Upload
# Attachment: test-utility-bill.pdf
```

#### Verify in Code
```typescript
// Check /pages/api/webhooks/resend-incoming-email.ts logs
console.log('Received email from:', from);
console.log('Attachments:', attachments.length);
```

---

### 3. Test ClickSend SMS Webhook

#### Create Test Inbound SMS
```bash
# Send SMS/MMS to your ClickSend number
# From: Your phone
# To: Your ClickSend inbound number
# Message: "Test upload"
# Attachment: Photo of ID or utility bill
```

#### Verify in Code
```typescript
// Check /pages/api/webhooks/clicksend-incoming-sms.ts logs
console.log('Received SMS from:', from);
console.log('Media files:', media?.length);
```

---

## 🚀 Automated Testing Script

Create `/scripts/test-webhooks.sh`:

```bash
#!/bin/bash

echo "🧪 Testing all webhooks..."

# Test Stripe
echo "\n1️⃣ Testing Stripe webhook..."
stripe trigger customer.subscription.created --forward-to https://autopilotamerica.com/api/webhooks/stripe

# Test Resend (requires manual email)
echo "\n2️⃣ Testing Resend webhook..."
echo "   Please send test email to uploads@autopilotamerica.com"
echo "   Waiting 30 seconds..."
sleep 30

# Test ClickSend (requires manual SMS)
echo "\n3️⃣ Testing ClickSend webhook..."
echo "   Please send test SMS/MMS to your ClickSend number"
echo "   Waiting 30 seconds..."
sleep 30

echo "\n✅ Manual verification required:"
echo "   - Check Vercel logs: vercel logs --follow"
echo "   - Check database audit logs"
echo "   - Verify no 404 or 500 errors"
```

---

## 📈 Monitoring Webhooks in Production

### Set Up Vercel Log Monitoring
```bash
# Continuous monitoring
vercel logs --follow | grep -E "webhook|error|500|404"

# Check recent webhook activity
vercel logs | grep -A 5 "POST /api/webhooks"
```

### Set Up Daily Health Check Cron

Create `/pages/api/cron/webhook-health-check.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Check webhook errors in last 24 hours
  const { data: errors, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('action_type', 'webhook_error')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (errors && errors.length > 5) {
    // Send alert email
    await resend.emails.send({
      from: 'alerts@autopilotamerica.com',
      to: 'randy@autopilotamerica.com',
      subject: '🚨 Webhook Health Alert: Multiple Failures Detected',
      html: `
        <h2>Webhook Health Alert</h2>
        <p>${errors.length} webhook errors detected in the last 24 hours.</p>
        <ul>
          ${errors.map(e => `
            <li>
              <strong>${e.entity_type}</strong>: ${e.action_details?.error || 'Unknown error'}
              <br><small>${new Date(e.created_at).toLocaleString()}</small>
            </li>
          `).join('')}
        </ul>
        <p><a href="https://dashboard.stripe.com/webhooks">Check Stripe Webhooks →</a></p>
      `,
    });
  }

  return res.status(200).json({
    status: 'ok',
    errors: errors?.length || 0,
  });
}
```

Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/webhook-health-check",
      "schedule": "0 9 * * *"
    }
  ]
}
```

---

## 🎯 Quick Reference: Testing Commands

```bash
# Stripe
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
stripe trigger checkout.session.completed

# Vercel logs
vercel logs --follow
vercel logs | grep "webhook"

# Check webhook URLs
curl -I https://autopilotamerica.com/api/webhooks/stripe
curl -I https://autopilotamerica.com/api/webhooks/resend-incoming-email
curl -I https://autopilotamerica.com/api/webhooks/clicksend-incoming-sms

# Database audit logs
psql $DATABASE_URL -c "SELECT * FROM audit_logs WHERE action_type LIKE '%webhook%' ORDER BY created_at DESC LIMIT 10;"
```

---

## 🔐 Security Best Practices

### 1. Always Verify Webhook Signatures
```typescript
// Stripe
const signature = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

// Resend
const signature = req.headers['svix-signature'];
const webhook = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
webhook.verify(body, signature);
```

### 2. Never Trust Webhook Data Without Verification
```typescript
// ❌ BAD: Trust data immediately
const userId = webhookData.userId;
await updateUser(userId, webhookData);

// ✅ GOOD: Verify user exists and validate data
const { data: user } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('user_id', webhookData.userId)
  .single();

if (!user) {
  return res.status(400).json({ error: 'Invalid user' });
}
```

### 3. Use Environment-Specific Secrets
```bash
# Development
STRIPE_WEBHOOK_SECRET=whsec_test_...

# Production
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. Rate Limit Webhook Endpoints
```typescript
// Use Vercel's edge config or Upstash for rate limiting
import { Ratelimit } from '@upstash/ratelimit';

const ratelimit = new Ratelimit({
  redis: /* ... */,
  limiter: Ratelimit.slidingWindow(100, '1 m'),
});

const { success } = await ratelimit.limit(req.headers['x-forwarded-for']);
if (!success) {
  return res.status(429).json({ error: 'Too many requests' });
}
```

---

## 📝 Summary: Your Action Items

### Immediate (Today)
- [x] Fix Stripe webhook 404 (already done)
- [ ] Test Stripe webhook with `stripe trigger customer.subscription.created`
- [ ] Review Stripe dashboard for any failed events in last week
- [ ] Manually retry any failed Stripe events

### This Week
- [ ] Create webhook monitoring dashboard at `/admin/webhooks`
- [ ] Set up daily webhook health check cron job
- [ ] Test Resend email webhook by sending test email
- [ ] Test ClickSend SMS webhook by sending test MMS

### Ongoing (Monthly)
- [ ] Review webhook health checklist
- [ ] Check Stripe dashboard for failures
- [ ] Verify all webhook secrets are up to date
- [ ] Test each webhook endpoint manually

---

## 🆘 Troubleshooting Guide

### Problem: Webhook returns 404
**Cause**: File path doesn't match URL
**Fix**: Create file at exact path matching webhook URL
```typescript
// URL: /api/webhooks/stripe
// File: /pages/api/webhooks/stripe.ts ✅
```

### Problem: Webhook returns 500
**Cause**: Unhandled error in webhook handler
**Fix**: Add try/catch and logging
```typescript
try {
  // Process webhook
} catch (error) {
  console.error('Webhook error:', error);
  return res.status(500).json({ error: error.message });
}
```

### Problem: Signature verification fails
**Cause**: Wrong secret or body parsing issue
**Fix**: Disable body parser and verify secret
```typescript
export const config = {
  api: { bodyParser: false }
};

// Verify secret matches environment variable
console.log('Using secret:', process.env.STRIPE_WEBHOOK_SECRET?.slice(0, 10) + '...');
```

### Problem: Webhook times out
**Cause**: Long-running operation blocking response
**Fix**: Return 200 immediately, process async
```typescript
// ❌ BAD: Wait for processing
await processWebhook(event);
return res.status(200).json({ received: true });

// ✅ GOOD: Return immediately, process async
res.status(200).json({ received: true });
processWebhook(event).catch(console.error);
```

---

## 🎓 Additional Resources

- [Stripe Webhook Testing Guide](https://stripe.com/docs/webhooks/test)
- [Vercel Serverless Functions](https://vercel.com/docs/functions/serverless-functions)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)
- [Webhook Security Best Practices](https://webhooks.fyi/security/overview)
