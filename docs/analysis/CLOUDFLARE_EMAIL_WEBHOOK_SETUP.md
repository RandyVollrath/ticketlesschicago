# Cloudflare Email Routing Webhook Setup

## Current Setup
You already have `documents@autopilotamerica.com` configured in Cloudflare Email Routing.

## Add Webhook for Pattern Matching

### Step 1: Go to Cloudflare Dashboard
1. Log in to Cloudflare
2. Select your domain: `autopilotamerica.com`
3. Go to **Email** → **Email Routing** in the left sidebar

### Step 2: Create Custom Address with Wildcard
1. Click **"Routing rules"** tab
2. Click **"Create address"** or **"Add custom address"**
3. Configure:
   - **Custom address**: `documents+*` (the `*` matches any UUID)
   - **Action**: Choose **"Send to a Worker"** or **"Send to webhook"**
   - **Destination URL**: `https://ticketlesschicago.com/api/email/process-residency-proof`

### Step 3: Cloudflare Worker (If "Send to webhook" not available)

If Cloudflare doesn't have direct webhook option, create a Worker:

1. Go to **Workers & Pages** in Cloudflare Dashboard
2. Click **"Create Worker"**
3. Name it: `email-residency-proof-router`
4. Paste this code:

```javascript
export default {
  async email(message, env, ctx) {
    // Extract email data
    const reader = message.raw.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const rawEmail = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      rawEmail.set(chunk, offset);
      offset += chunk.length;
    }

    // Get attachments
    const attachments = [];
    for (const attachment of message.attachments) {
      const buffer = await attachment.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      attachments.push({
        filename: attachment.name,
        contentType: attachment.type,
        content: base64
      });
    }

    // Forward to your webhook
    const webhookPayload = {
      to: message.to,
      from: message.from,
      subject: message.headers.get('subject'),
      text: await message.text(),
      html: await message.html?.() || '',
      attachments: attachments,
      headers: Object.fromEntries(message.headers)
    };

    const response = await fetch('https://ticketlesschicago.com/api/email/process-residency-proof', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload)
    });

    if (response.ok) {
      console.log('✓ Email processed successfully');
    } else {
      console.error('✗ Email processing failed:', await response.text());
    }
  }
}
```

5. Click **"Save and Deploy"**
6. Go back to **Email Routing**
7. Create custom address: `documents+*` → **Send to Worker** → Select `email-residency-proof-router`

### Step 4: Test the Setup

Send a test email:
```bash
# From your personal email, send an email with a PDF attachment to:
documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com

# Subject: Test Utility Bill
# Attachment: test_bill.pdf
```

Check Vercel logs:
```bash
vercel logs
```

You should see:
```
📧 Received email: From=your@email.com, To=documents+049f3b4a...@autopilotamerica.com
🔍 User ID: 049f3b4a-32d4-4d09-87de-eb0cfe33c04e
✓ Found user: 049f3b4a-32d4-4d09-87de-eb0cfe33c04e
📎 Found PDF attachment: test_bill.pdf
📤 Uploading to: proof/049f3b4a-32d4-4d09-87de-eb0cfe33c04e/2025-01-15/bill.pdf
✓ Bill uploaded successfully
✅ Successfully processed utility bill for user 049f3b4a-32d4-4d09-87de-eb0cfe33c04e
```

### Alternative: Update Existing `documents@` Address

If you already have `documents@autopilotamerica.com` routing somewhere:

1. **Edit the existing routing rule**
2. Change destination from current (e.g., Gmail forwarding) to **Worker** or **Webhook**
3. This will catch ALL emails to `documents@...` including `documents+{uuid}@...`

## Troubleshooting

### Worker Not Receiving Emails
- Check **Email Routing** → **Settings** → Ensure Email Routing is **Enabled**
- Verify MX records are pointing to Cloudflare
- Check DNS propagation: `dig MX autopilotamerica.com`

### Webhook Not Being Called
- Check Worker logs in Cloudflare Dashboard
- Verify webhook URL is correct: `https://ticketlesschicago.com/api/email/process-residency-proof`
- Test webhook directly with curl:
```bash
curl -X POST https://ticketlesschicago.com/api/email/process-residency-proof \
  -H "Content-Type: application/json" \
  -d '{
    "to": "documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com",
    "from": "test@example.com",
    "subject": "Test",
    "text": "Test body"
  }'
```

### PDF Not Being Extracted
- Ensure attachment is actually a PDF (check `contentType: "application/pdf"`)
- Check Worker code is properly encoding attachment to base64
- Verify formidable is parsing multipart form correctly in your API endpoint

## Cost
- **Cloudflare Email Routing**: FREE (unlimited)
- **Cloudflare Workers**: FREE (100,000 requests/day on free plan)
- **Total**: $0
