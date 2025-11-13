# Critical Infrastructure - DO NOT MODIFY WITHOUT REVIEW

This document lists critical files and configurations that power essential features.
**Modifying these without understanding the full system can break production features.**

## 🚨 Utility Bills Email Processing (Residency Proof)

### Purpose
Automatically processes forwarded utility bills via email for users who need proof of residency for city sticker renewals with parking protection.

### Critical Files - PROTECTED
- **`pages/api/utility-bills.ts`** - Main webhook endpoint that processes emails
- **`pages/api/health/utility-bills.ts`** - Health check monitoring
- **`pages/api/cron/monitor-utility-bills-webhook.ts`** - Daily automated health checks
- **`vercel.json`** - Contains webhook cron schedule (line 113-115)

### Critical Configuration - DO NOT CHANGE

#### Resend Webhook URL (in Resend Dashboard)
```
https://www.ticketlesschicago.com/api/utility-bills
```

**⚠️ IMPORTANT:**
- MUST use `www.ticketlesschicago.com` (NOT `ticketlesschicago.com` - that redirects!)
- MUST be exactly `/api/utility-bills` (matches file `pages/api/utility-bills.ts`)
- Event type: `email.received`

#### Supported Email Addresses
- Production: `{user_uuid}@bills.autopilotamerica.com`
- Testing: `{user_uuid}@linguistic-louse.resend.app`

#### DNS MX Record (Cloudflare)
```
Type: MX
Name: bills.autopilotamerica.com
Content: inbound-smtp.us-east-1.amazonaws.com
Priority: 10
```

**⚠️ DO NOT DELETE THIS MX RECORD** - It routes all utility bill emails!

#### Supabase Storage
- **Bucket:** `residency-proofs-temps`
- **DO NOT RENAME OR DELETE THIS BUCKET**
- Path format: `proof/{user_uuid}/{yyyy-mm-dd}/bill.pdf`

#### Environment Variables Required
```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
```

**⚠️ If these are missing or invalid, webhook will fail!**

### How to Verify It's Working

#### 1. Check Health Status
```bash
curl https://www.ticketlesschicago.com/api/health/utility-bills
```

Should return:
```json
{
  "overall_status": "healthy",
  "checks": {
    "supabase_storage": { "status": "ok" },
    "storage_bucket": { "status": "ok", "bucket": "residency-proofs-temps" },
    "database": { "status": "ok" },
    "resend_api_key": { "status": "ok" }
  }
}
```

#### 2. Run Integration Tests
```bash
node scripts/test-utility-bill-webhook.js
```

Should show all tests passing.

#### 3. Check Automated Monitoring
- Runs daily at 8am CT (14:00 UTC)
- Sends email alert if any checks fail
- Cron: `/api/cron/monitor-utility-bills-webhook`

### What Could Break This Feature

| Risk | How It Could Happen | Prevention |
|------|---------------------|------------|
| **Webhook URL changes** | Someone updates Resend webhook settings | Document critical URL, add CODEOWNERS |
| **Domain redirect changes** | Vercel/Cloudflare DNS changes | Use www domain, document in CRITICAL_INFRASTRUCTURE.md |
| **File renamed/deleted** | Refactoring without understanding dependencies | CODEOWNERS protection, integration tests |
| **Storage bucket deleted** | Supabase cleanup gone wrong | Document bucket name, health check alerts |
| **MX record deleted** | DNS changes | Document DNS config, test email routing |
| **API keys expire** | Key rotation without updating env vars | Health check detects missing keys |
| **Deployment fails** | Code breaks, silent failure | Daily health check cron sends alerts |

### Recovery Procedures

#### If webhook stops working:

1. **Check health endpoint first:**
   ```bash
   curl https://www.ticketlesschicago.com/api/health/utility-bills
   ```

2. **Verify Resend webhook URL:**
   - Login to Resend: https://resend.com/webhooks
   - Confirm URL is: `https://www.ticketlesschicago.com/api/utility-bills`
   - Confirm listening for: `email.received`

3. **Check recent webhook events:**
   - View Resend webhook events tab
   - Look for errors in response body
   - Check HTTP status codes (should be 200)

4. **Verify DNS:**
   ```bash
   dig MX bills.autopilotamerica.com
   ```
   Should show: `inbound-smtp.us-east-1.amazonaws.com`

5. **Check Vercel deployment:**
   - https://vercel.com/ticketless-chicago/deployments
   - Verify latest deployment succeeded
   - Check function logs for errors

6. **Test manually:**
   Send email to: `8777a96d-dfdc-48ab-9dd2-182c9e34080a@linguistic-louse.resend.app`
   With PDF attachment, check Supabase storage for upload

### Contacts
- Primary: Randy Vollrath (randyvollrath@gmail.com)
- Resend Support: https://resend.com/support
- Vercel Support: https://vercel.com/support

### Last Updated
2025-11-13 - Initial documentation after feature launch
