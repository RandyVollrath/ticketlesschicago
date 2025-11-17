# Webhook Security Setup

## Quick Reference

Your webhook signature verification is **implemented and deployed**, but needs secrets configured to be fully active.

---

## Step 1: Get Resend Webhook Secret

1. Go to https://resend.com/settings/webhooks
2. Find your webhook for incoming emails
3. Copy the **signing secret** (starts with `whsec_`)

---

## Step 2: Generate ClickSend Secret

Run this command:
```bash
openssl rand -hex 32
```

Copy the output (it will be a long random string).

---

## Step 3: Add Secrets to Vercel

```bash
# Add Resend secret
npx vercel env add RESEND_WEBHOOK_SECRET
# Paste: whsec_xxxxx (from Step 1)

# Add ClickSend secret
npx vercel env add CLICKSEND_WEBHOOK_SECRET
# Paste: your-generated-token (from Step 2)
```

When prompted, select:
- Environment: **Production, Preview, Development** (all three)
- Add to all scopes? **Yes**

---

## Step 4: Update ClickSend Webhook URL

1. Go to https://dashboard.clicksend.com
2. Navigate to: **SMS > Settings > Inbound SMS Rules**
3. Find your inbound SMS webhook
4. Update the URL to:
   ```
   https://ticketlessamerica.com/api/webhooks/clicksend-incoming-sms?token=YOUR_GENERATED_TOKEN
   ```
   (Replace `YOUR_GENERATED_TOKEN` with the token from Step 2)

---

## Step 5: Redeploy

```bash
npx vercel --prod
```

This ensures the new environment variables are loaded.

---

## How to Test

### Test Resend Webhook:
1. Send a test email to your incoming email address
2. Check Vercel logs for: `📧 Incoming email webhook called (verified ✅)`
3. If you see `⚠️ Resend webhook verification failed`, check your secret

### Test ClickSend Webhook:
1. Send a test SMS to your ClickSend number
2. Check Vercel logs for: `📱 Incoming SMS webhook called (verified ✅)`
3. If you see `⚠️ ClickSend webhook verification failed`, check your token

---

## Current Behavior (Without Secrets)

**Resend:**
- Logs warning: `RESEND_WEBHOOK_SECRET not set - webhook verification disabled`
- Still processes webhooks (development mode)

**ClickSend:**
- Processes webhooks without verification (optional security)

**After adding secrets:**
- Both webhooks will **reject** unauthorized requests with `401 Unauthorized`
- Only authentic webhooks from Resend/ClickSend will be processed

---

## Security Benefits

✅ Prevents attackers from spoofing webhook requests
✅ Prevents replay attacks (5-minute timestamp window for Resend)
✅ Ensures webhooks are authentic
✅ Logs all verification attempts

---

## Troubleshooting

**"Webhook verification failed" in logs:**
- Check that environment variables are set correctly
- Ensure you redeployed after adding secrets
- Verify ClickSend URL includes the correct token parameter

**Can't find webhook secret in Resend:**
- Make sure you've created a webhook in Resend dashboard
- The secret is shown when you create/edit a webhook
- Contact Resend support if you can't find it

**ClickSend webhook not working:**
- Verify the token in the URL matches `CLICKSEND_WEBHOOK_SECRET`
- Check ClickSend dashboard webhook configuration
- Ensure URL is correct: `https://ticketlessamerica.com/api/webhooks/clicksend-incoming-sms?token=...`

---

## Need Help?

If you run into issues, check:
1. Vercel deployment logs: `npx vercel logs`
2. Environment variables: `npx vercel env ls`
3. Webhook endpoints are accessible: Test with curl

All webhook verification code is in:
- `lib/webhook-verification.ts` - Verification logic
- `pages/api/webhooks/resend-incoming-email.ts` - Resend endpoint
- `pages/api/webhooks/clicksend-incoming-sms.ts` - ClickSend endpoint
