# Cloudflare Email Routing Setup Guide

## Overview
This guide will help you configure Cloudflare Email Routing to handle `documents+{uuid}@autopilotamerica.com` addresses. Once set up, Gmail verification emails will be handled automatically and users can forward their utility bills without any technical knowledge.

## What You're Setting Up
- **Email Pattern**: `documents+*@autopilotamerica.com` (catches all UUIDs)
- **Action**: Route emails to webhook at `https://ticketlesschicago.com/api/email/process-residency-proof`
- **Auto-Features**:
  - ✅ Gmail forwarding verification (automatic)
  - ✅ Utility bill processing (automatic)
  - ✅ Old bill deletion (automatic)

---

## Step-by-Step Instructions

### Step 1: Log into Cloudflare
1. Go to https://dash.cloudflare.com/
2. Log in with your Cloudflare account
3. Select your domain: **autopilotamerica.com**

### Step 2: Navigate to Email Routing
1. In the left sidebar, click **"Email"** (or **"Email Routing"**)
2. If this is your first time:
   - Click **"Get started"**
   - Cloudflare will verify your domain automatically
   - Wait for DNS records to propagate (usually instant)

### Step 3: Create a Custom Address with Wildcard

#### Option A: Using Cloudflare Workers (Recommended - Most Control)

1. **Create the Worker**:
   ```bash
   # In the Cloudflare dashboard, go to:
   Workers & Pages → Create Worker
   ```

2. **Name it**: `email-forwarding-handler`

3. **Paste this code**:
   ```javascript
   export default {
     async email(message, env, ctx) {
       try {
         // Convert message to webhook-friendly format
         const attachments = [];

         for (const attachment of message.attachments) {
           const buffer = await attachment.arrayBuffer();
           const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

           attachments.push({
             filename: attachment.name,
             contentType: attachment.type,
             content: base64,
           });
         }

         // Get email body
         const text = await message.text?.() || '';
         const html = await message.html?.() || '';

         // Build webhook payload matching SendGrid Inbound Parse format
         const payload = {
           to: message.to,
           from: message.from,
           subject: message.headers.get('subject') || '',
           text: text,
           html: html,
           attachments: attachments,
           headers: Object.fromEntries(message.headers),
         };

         // Forward to webhook
         const response = await fetch('https://ticketlesschicago.com/api/email/process-residency-proof', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
           },
           body: JSON.stringify(payload),
         });

         if (response.ok) {
           console.log('✓ Email processed successfully');
         } else {
           const errorText = await response.text();
           console.error('✗ Email processing failed:', errorText);
           throw new Error(`Webhook failed: ${response.status} ${errorText}`);
         }
       } catch (error) {
         console.error('Error processing email:', error);
         throw error;
       }
     },
   };
   ```

4. **Click "Save and Deploy"**

5. **Configure Email Routing**:
   - Go back to: **Email → Email Routing**
   - Click **"Routing rules"** tab
   - Click **"Create address"** or **"Add custom address"**
   - **Custom address**: `documents+*`
   - **Action**: Select **"Send to a Worker"**
   - **Worker**: Select `email-forwarding-handler`
   - Click **"Save"**

#### Option B: Using Direct Webhook (If Available)

Some Cloudflare plans support direct webhooks:

1. Click **"Routing rules"** tab
2. Click **"Create address"**
3. **Custom address**: `documents+*`
4. **Action**: **"Send to webhook"**
5. **Webhook URL**: `https://ticketlesschicago.com/api/email/process-residency-proof`
6. Click **"Save"**

---

### Step 4: Verify Configuration

1. **Check DNS Records**:
   ```bash
   # MX records should point to Cloudflare
   dig MX autopilotamerica.com

   # Expected output should include:
   # autopilotamerica.com. MX 10 amir.mx.cloudflare.net.
   # autopilotamerica.com. MX 10 isaac.mx.cloudflare.net.
   ```

2. **Test with a Real Email**:
   - From your personal Gmail, send a test email to:
     ```
     documents+00000000-0000-0000-0000-000000000000@autopilotamerica.com
     ```
   - Attach a PDF file
   - Subject: "Test Utility Bill"

3. **Check Vercel Logs**:
   ```bash
   vercel logs --follow
   ```

   You should see:
   ```
   📧 Received email: From=your@gmail.com, To=documents+00000000...
   ❌ User not found for UUID: 00000000-0000-0000-0000-000000000000
   ```

   This is EXPECTED! It means Cloudflare routing is working. The user doesn't exist, but the email was received.

---

### Step 5: Test Gmail Verification (The Real Test!)

Now let's test the automatic Gmail verification:

1. **Set up a Gmail filter to forward to your test address**:
   - Go to Gmail
   - Search for any email from yourself
   - Click "Show search options" (the dropdown in search bar)
   - Enter your email in "From" field
   - Click "Create filter"
   - Check "Forward it to"
   - Enter: `documents+00000000-0000-0000-0000-000000000000@autopilotamerica.com`
   - Gmail will say "A verification code has been sent"

2. **Check Vercel Logs IMMEDIATELY**:
   ```bash
   vercel logs --follow
   ```

   You should see:
   ```
   📧 Received email: From=forwarding-noreply@google.com, To=documents+00000000...
   🔐 Detected Gmail verification email, processing...
   ✓ Found confirmation URL, verifying...
   ✅ Gmail forwarding address verified automatically!
   ```

3. **Verify in Gmail**:
   - Go back to Gmail filter creation
   - The forwarding address should now show as **"Verified"** ✅
   - Complete the filter creation

4. **Success!** 🎉 Gmail verification is working automatically!

---

## Troubleshooting

### Issue: Emails not arriving at webhook

**Solution 1: Check Worker logs**
```bash
# In Cloudflare Dashboard:
Workers & Pages → email-forwarding-handler → View logs
```

**Solution 2: Verify email routing is enabled**
```bash
# In Cloudflare Dashboard:
Email → Email Routing → Ensure "Status: Enabled"
```

**Solution 3: Check MX records**
```bash
dig MX autopilotamerica.com

# Should return Cloudflare MX records:
# amir.mx.cloudflare.net
# isaac.mx.cloudflare.net
```

### Issue: Gmail verification not working

**Check 1: Webhook received the verification email**
```bash
vercel logs | grep "Detected Gmail verification"
```

**Check 2: Confirmation URL was extracted**
```bash
vercel logs | grep "Found confirmation URL"
```

**Check 3: Verification request succeeded**
```bash
vercel logs | grep "Gmail forwarding address verified"
```

**Fix: Update URL regex if Gmail changed format**
Edit `/pages/api/email/process-residency-proof.ts` and adjust the regex:
```typescript
const urlMatch = emailBody.match(/(https:\/\/mail\.google\.com\/mail\/vf[^\s<>"']+)/i);
```

### Issue: Worker deployment failed

**Common causes**:
- Syntax error in Worker code
- Missing `email` handler function
- Worker not bound to email routing rule

**Solution**:
1. Redeploy the Worker
2. Check "Quick Edit" in Workers dashboard for errors
3. Verify Worker is selected in Email Routing rules

---

## Testing Checklist

Before announcing to users:

- [ ] Cloudflare Email Routing is enabled
- [ ] MX records point to Cloudflare
- [ ] Worker is deployed and working
- [ ] Test email with PDF attachment is received
- [ ] Webhook is called successfully
- [ ] Gmail verification email is detected
- [ ] Confirmation URL is extracted
- [ ] Automatic verification completes
- [ ] Gmail shows forwarding address as "Verified"
- [ ] Real utility bill forwarding works end-to-end

---

## Cost

**Cloudflare Email Routing**: FREE (unlimited emails)
**Cloudflare Workers**: FREE (100,000 requests/day on free plan)

**Total monthly cost**: $0

---

## Next Steps

Once this is working:

1. ✅ **Deploy to production** - The code is already deployed
2. ✅ **Test with real users** - Have a beta user try the setup
3. 📧 **Monitor webhook logs** - Watch for any errors
4. 🎥 **Create video tutorial** - Record a 30-second walkthrough
5. 📊 **Track adoption** - See how many users set up forwarding

---

## Support

If users report issues:

1. **Check Vercel logs**: `vercel logs --follow`
2. **Check Cloudflare Worker logs**: Dashboard → Workers → email-forwarding-handler → Logs
3. **Verify email routing status**: Dashboard → Email → Status: Enabled
4. **Test with their UUID**: Send a test email to `documents+{their-uuid}@autopilotamerica.com`

---

## Summary

✅ **Cloudflare Email Routing**: Free, unlimited, reliable
✅ **Cloudflare Worker**: Converts email to webhook format
✅ **Auto Gmail Verification**: Users don't need to do anything technical
✅ **Webhook Processing**: Extracts PDF, stores in Supabase, deletes old bills
✅ **Zero Cost**: Completely free on Cloudflare free plan

**User Experience**: Set up Gmail filter once → Bills forward forever → Zero manual work
