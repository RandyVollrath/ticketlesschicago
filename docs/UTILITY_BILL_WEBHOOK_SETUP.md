# Utility Bill Webhook Setup

## Working Configuration

### Resend Webhook URL
```
https://www.ticketlesschicago.com/api/utility-bills
```

**IMPORTANT:** Must use `www.ticketlesschicago.com` - the apex domain redirects and will fail!

### Email Addresses Supported
- Production: `{user_uuid}@bills.autopilotamerica.com`
- Testing: `{user_uuid}@linguistic-louse.resend.app`

### Test User UUID
```
8777a96d-dfdc-48ab-9dd2-182c9e34080a
```

Test email: `8777a96d-dfdc-48ab-9dd2-182c9e34080a@linguistic-louse.resend.app`

### Supabase Storage
- **Bucket:** `residency-proofs-temps`
- **Path format:** `proof/{user_uuid}/{yyyy-mm-dd}/bill.pdf`
- **Privacy:** Only keeps most recent bill, deletes old ones

### Health Check
Check if the latest code is deployed:
```bash
curl https://www.ticketlesschicago.com/api/utility-bills
```

Should return:
```json
{
  "status": "ok",
  "service": "utility-bills-webhook",
  "version": "2.0-full-processing",
  "timestamp": "2025-11-13T06:14:00.000Z"
}
```

## How It Works

1. User forwards utility bill email to `{their_uuid}@bills.autopilotamerica.com`
2. Cloudflare MX records route email to Resend inbound servers
3. Resend receives email and calls webhook with `email.received` event
4. Webhook:
   - Extracts user UUID from email address
   - Verifies user has `has_protection=true` and `has_permit_zone=true`
   - Finds PDF attachment
   - Downloads PDF from Resend API (2-step process)
   - Deletes old bills from storage
   - Uploads new PDF to `residency-proofs-temps` bucket
   - Updates `user_profiles` table with file path and timestamp

## DNS Configuration

### Cloudflare MX Records for bills subdomain
```
Type: MX
Name: bills
Content: inbound-smtp.us-east-1.amazonaws.com
Priority: 10
```

## Troubleshooting

### Webhook returns old test response
- Check you're using `www.ticketlesschicago.com` not apex domain
- Check health check endpoint shows correct version
- Verify Vercel deployment completed (check Vercel dashboard)

### PDF not appearing in storage
- Check Resend webhook logs for error messages
- Verify user has `has_protection=true` and `has_permit_zone=true`
- Check email was sent with PDF attachment
- Look for detailed logs in Vercel function logs

### Email not received
- Verify MX record is configured correctly: `dig MX bills.autopilotamerica.com`
- Check Resend receiving emails dashboard
- Verify domain is configured in Resend

## Files
- **Webhook endpoint:** `pages/api/utility-bills.ts`
- **Database migration:** `database/COMPLETE_MIGRATIONS.sql`
- **Storage bucket:** `residency-proofs-temps` (in Supabase)
