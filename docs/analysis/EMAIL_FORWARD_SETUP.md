# Email Forward Feature Setup Guide

## Overview
Users can forward their Chicago city sticker email → system extracts vehicle info → sends pre-filled signup link.

## Setup Steps

### 1. Get Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign in or create an account
3. Go to "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-`)
6. Add to `.env.local`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
7. Also add to Vercel environment variables

**Cost:** ~$0.01 per email (Claude 3.5 Sonnet)

### 2. Run Database Migration

Run this SQL in your Supabase SQL editor:

```sql
-- From migrations/create_signup_tokens.sql
CREATE TABLE IF NOT EXISTS signup_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_signup_tokens_token ON signup_tokens(token) WHERE NOT used;
CREATE INDEX idx_signup_tokens_expires ON signup_tokens(expires_at);

CREATE OR REPLACE FUNCTION cleanup_expired_signup_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM signup_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

### 3. Set Up Resend Inbound Email

**Note:** Resend inbound email is currently in beta. You may need to request access.

1. **Request Access (if needed)**
   - Go to https://resend.com/docs/dashboard/inbound-emails/introduction
   - Contact Resend support to enable inbound email for your account

2. **Add Domain (if not already done)**
   - Go to https://resend.com/domains
   - Add `ticketlessamerica.com` (or your domain)
   - Verify DNS records

3. **Create Inbound Email Address**
   - Go to https://resend.com/inbound
   - Click "Create Inbound Email"
   - Configure:
     - **Email:** `forward@ticketlessamerica.com`
     - **Webhook URL:** `https://ticketlessamerica.com/api/email/forward`
     - **Forward to:** (optional - leave blank)

4. **Update MX Records**
   - Resend will provide MX records
   - Add them to your domain DNS:
     ```
     MX  forward.ticketlessamerica.com  →  mx.resend.com  (priority 10)
     ```

5. **Test the Endpoint**
   ```bash
   # From your local machine
   node scripts/test-email-forward.js
   ```

### 4. Alternative: Use a Subdomain

If you don't want to mess with your main domain's email:

1. Use `forward.ticketless.app` or similar subdomain
2. Set up MX records only for that subdomain
3. Update the email address in your marketing: "Forward your city sticker email to forward@ticketless.app"

### 5. Deploy

```bash
npm run deploy
```

## Testing

### Local Test
```bash
# Make sure dev server is running
npm run dev

# In another terminal
BASE_URL=http://localhost:3000 node scripts/test-email-forward.js
```

### Production Test
Forward a real city sticker email to `forward@ticketlessamerica.com` or manually send a test email to your webhook.

## User Flow

1. **User receives city sticker email from Chicago**
2. **User forwards it to:** `forward@ticketlessamerica.com`
3. **System:**
   - Receives email via Resend webhook
   - Parses with Claude API
   - Extracts: name, VIN, plate, make, model, renewal date
   - Generates secure token
   - Sends reply email with signup link
4. **User clicks link →** signup form pre-filled with vehicle info
5. **User adds address + phone →** completes signup
6. **Done!** Now tracking that vehicle

## Email Templates

### Reply Email Sent to User
- Subject: "🚗 Complete Your Ticketless America Signup"
- Shows extracted vehicle info in blue box
- Big CTA button with signup link
- Link expires in 7 days

### For Existing Users
- Subject: "🚗 Add This Vehicle to Your Account"
- Shows extracted info
- Directs them to log in

## Troubleshooting

### Resend Inbound Not Working
- Check webhook is publicly accessible (not localhost)
- Verify MX records are set correctly
- Check Resend dashboard for delivery logs
- Make sure your Resend account has inbound email enabled

### Claude API Errors
- Verify API key is correct
- Check you have credits in Anthropic account
- Look at server logs for specific error messages

### Token Not Found
- Check `signup_tokens` table in Supabase
- Verify token wasn't already used
- Check expiration date

## Monitoring

Check these regularly:
- Resend inbound email logs
- Supabase `signup_tokens` table
- API route logs in Vercel
- Cost in Anthropic console (~$0.01/email)

## Future Enhancements

- [ ] Support other email formats (registration renewal, emissions)
- [ ] Handle multiple vehicles in one email
- [ ] OCR support for screenshot uploads
- [ ] SMS forwarding option