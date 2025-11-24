# Quick Cloudflare Email Routing Setup

## Current Status
✅ MX records are already pointing to Cloudflare
❌ No routing rule for `documents+*@autopilotamerica.com`

## Error You're Getting
```
550 5.1.1 Address does not exist
```

This means Cloudflare Email Routing doesn't have a rule to handle emails to `documents+{uuid}@autopilotamerica.com`.

---

## Fix: Add Email Routing Rule (5 minutes)

### Step 1: Go to Cloudflare Dashboard
1. Open: https://dash.cloudflare.com/
2. Log in
3. Select domain: **autopilotamerica.com**

### Step 2: Go to Email Routing
1. Click **"Email"** in the left sidebar
2. You should see "Email Routing" dashboard

### Step 3: Check if Email Routing is Enabled
- Look for status indicator at top
- Should say: "Email Routing: **Enabled**" or "Email Routing: **Active**"
- If not enabled:
  - Click "Enable Email Routing"
  - Cloudflare will verify your domain (instant since MX records already exist)

### Step 4: Create Routing Rule

#### Option A: Using Cloudflare Worker (Recommended)

1. **First, create the Worker:**
   - Go to: **Workers & Pages** (in sidebar)
   - Click **"Create Worker"** or **"Create Application" → "Create Worker"**
   - Name: `email-handler`
   - Click **"Deploy"**

2. **Edit the Worker code:**
   - Click **"Edit code"** or **"Quick edit"**
   - Delete all existing code
   - Paste this:

```javascript
export default {
  async email(message, env, ctx) {
    console.log('📧 Email received:', message.to, 'from:', message.from);

    try {
      // Build attachment list
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

      // Build webhook payload
      const payload = {
        to: message.to,
        from: message.from,
        subject: message.headers.get('subject') || '',
        text: text,
        html: html,
        attachments: attachments,
        headers: Object.fromEntries(message.headers),
      };

      console.log('📤 Forwarding to webhook...');

      // Forward to your API
      const response = await fetch('https://ticketlesschicago.com/api/email/process-residency-proof', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log('✅ Email processed successfully');
      } else {
        const errorText = await response.text();
        console.error('❌ Webhook failed:', response.status, errorText);
        throw new Error(`Webhook failed: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error processing email:', error);
      throw error;
    }
  },
};
```

3. **Click "Save and Deploy"**

4. **Go back to Email Routing:**
   - Navigate to: **Email** → **Email Routing**
   - Click **"Routing rules"** tab
   - Click **"Create address"** or **"Add custom address"**

5. **Configure the rule:**
   - **Custom address:** `documents+*`
   - **Action:** Select **"Send to a Worker"**
   - **Worker:** Select `email-handler` (the one you just created)
   - Click **"Save"**

#### Option B: Direct Webhook (If your plan supports it)

Some Cloudflare plans allow direct webhooks without a Worker:

1. Go to: **Email** → **Email Routing** → **Routing rules**
2. Click **"Create address"**
3. Configure:
   - **Custom address:** `documents+*`
   - **Action:** **"Send to webhook"**
   - **Webhook URL:** `https://ticketlesschicago.com/api/email/process-residency-proof`
4. Click **"Save"**

If you don't see "Send to webhook" option, use Option A (Worker) instead.

---

## Step 5: Test It

### Test 1: Send a test email
```
From: your personal Gmail
To: documents+91a10d75-6537-4ec0-82f7-8d014520a588@autopilotamerica.com
Attach: Any PDF file
Subject: Test Bill
```

### Test 2: Check Vercel logs
```bash
vercel logs --follow
```

You should see:
```
📧 Received email (Cloudflare): From=you@gmail.com, To=documents+91a10d75...
✅ Email processed successfully
```

Or if user doesn't exist:
```
📧 Received email (Cloudflare): From=you@gmail.com, To=documents+91a10d75...
❌ User not found for UUID: 91a10d75-6537-4ec0-82f7-8d014520a588
```

Both are good - it means email routing is working!

### Test 3: Check Cloudflare Worker logs (if using Worker)
1. Go to: **Workers & Pages** → **email-handler**
2. Click **"Logs"** tab
3. You should see the console.log output from the Worker

---

## Troubleshooting

### Still getting "Address does not exist"

**Check 1: Is Email Routing enabled?**
- Dashboard → Email → Should say "Enabled"

**Check 2: Is the routing rule created?**
- Dashboard → Email → Routing rules
- Should see: `documents+*` → Worker: email-handler (or webhook)

**Check 3: MX records propagated?**
```bash
dig MX autopilotamerica.com
```
Should show Cloudflare MX records (you already have this ✅)

**Check 4: Worker is deployed?**
- Dashboard → Workers & Pages → email-handler
- Status should be "Deployed"

### Worker not receiving emails

**Fix:** Make sure the Worker has the `email` handler function, not just `fetch`:
```javascript
export default {
  async email(message, env, ctx) {  // ← Must be called "email"
    // ... your code
  }
}
```

### Webhook returning errors

Check Vercel logs:
```bash
vercel logs --follow
```

Common issues:
- User UUID doesn't exist (expected for test UUIDs)
- PDF parsing failed
- Supabase storage error

---

## Quick Checklist

- [ ] Go to Cloudflare Dashboard
- [ ] Select autopilotamerica.com domain
- [ ] Go to Email → Email Routing
- [ ] Verify Email Routing is Enabled
- [ ] Create Worker (if using Worker approach)
- [ ] Create routing rule: `documents+*` → Worker or Webhook
- [ ] Send test email
- [ ] Check Vercel logs
- [ ] Verify email was received

---

## What Happens After Setup

1. ✅ User forwards utility bill → `documents+{their-uuid}@autopilotamerica.com`
2. ✅ Cloudflare receives email
3. ✅ Worker converts to JSON format
4. ✅ Webhook at `/api/email/process-residency-proof` processes it
5. ✅ PDF extracted and stored in Supabase
6. ✅ Database updated with `residency_proof_path`
7. ✅ Old bills (60+ days) automatically deleted by cron

---

## Cost

**Cloudflare Email Routing:** FREE (unlimited)
**Cloudflare Worker:** FREE (100,000 requests/day)

**Total:** $0/month

---

## Need Help?

If you get stuck, check:
1. Cloudflare Email Routing status
2. Worker logs (if using Worker)
3. Vercel webhook logs
4. MX records with `dig MX autopilotamerica.com`

DM me with the specific error and I'll help troubleshoot!
