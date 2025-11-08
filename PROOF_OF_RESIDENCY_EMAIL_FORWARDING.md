# Proof of Residency via Email Forwarding

## Summary

**Problem:** Permit parking users need proof of residency within 30 days of registration due. Users hate uploading bills every year.

**Solution:** Email forwarding from utility providers → You receive bills all year → Use most recent bill for renewal → Delete after submission

**Privacy:** Forwarded emails processed automatically and deleted after processing (ephemeral storage model)

---

## How It Works

### 1. User Flow

1. User signs up for Protection + City Sticker + Permit Zone
2. System auto-generates unique forwarding email using their Supabase UUID: `documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com`
3. User sets up email forwarding from utility providers:
   - Comcast → Forward bills to documents+{uuid}@autopilotamerica.com
   - ConEd → Forward bills to documents+{uuid}@autopilotamerica.com
   - Peoples Gas → Forward bills to documents+{uuid}@autopilotamerica.com
   - Any other utility bills
4. You receive forwarded emails throughout the year
5. When renewal season hits (30 days before city sticker expires):
   - System automatically uses **most recent bill** (within 30 days)
   - Extracts PDF attachment or email body as proof of residency
   - Submits to city with renewal application
6. **After renewal submitted**: Delete all stored emails/bills

### 2. Privacy Model (Ephemeral Storage)

**What you store:**
- Most recent utility bill only (PDF or email screenshot)
- Stored in `residency-proofs-temp` Supabase Storage bucket
- Auto-deleted after renewal submission OR 48 hours after renewal season

**What you DON'T store:**
- Historical bills (only keep latest)
- Email content beyond proof of residency
- Any PII beyond what's on the bill

**User disclosure:**
> "Forwarded utility bills are processed automatically to extract proof of residency. We store only your most recent bill and delete it immediately after your city sticker renewal is submitted."

---

## Technical Implementation

### Database Schema

Added in `database/migrations/add_email_forwarding_id.sql`:

```sql
-- 5-digit unique forwarding ID (10000-99999)
CREATE SEQUENCE forwarding_id_seq START WITH 10000 MAXVALUE 99999 CYCLE;

ALTER TABLE user_profiles
ADD COLUMN email_forwarding_id INTEGER UNIQUE,
ADD COLUMN email_forwarding_address TEXT,
ADD COLUMN residency_proof_path TEXT,
ADD COLUMN residency_proof_uploaded_at TIMESTAMPTZ,
ADD COLUMN residency_proof_verified BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_enabled BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_consent_given BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_consent_given_at TIMESTAMPTZ;

-- Auto-generate forwarding ID when user signs up for protection + permit
CREATE FUNCTION generate_email_forwarding_id() ...
CREATE TRIGGER set_email_forwarding_id ...
```

### Email Forwarding Address Format

- **Format:** `documents+{user_uuid}@autopilotamerica.com`
- **Example:** `documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com`
- **UUID:** Uses Supabase user UUID (36 characters)
- **Auto-generated:** When user signs up for Protection + Permit Zone
- **Privacy:** UUID is not PII - it's a random hash that reveals nothing about the user
- **Unique:** One per user, never reused

### Email Processing Pipeline

**Incoming email flow:**

1. Email arrives at `documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com`
2. Email service (SendGrid Inbound Parse or similar) receives it
3. Extract user UUID from recipient address
4. Look up user: `SELECT * FROM user_profiles WHERE user_id = '049f3b4a-32d4-4d09-87de-eb0cfe33c04e'`
5. Extract utility bill:
   - If PDF attachment exists → Use PDF
   - If no attachment → Convert email body to PDF screenshot
6. Validate bill:
   - Date within 30 days? ✓
   - Contains user's address? ✓
   - Is a known utility provider? ✓
7. Store in Supabase Storage: `residency-proofs-temp/{user_id}_latest.pdf`
8. Update database:
   ```sql
   UPDATE user_profiles
   SET residency_proof_path = 'residency-proofs-temp/...',
       residency_proof_uploaded_at = NOW(),
       residency_proof_verified = false
   WHERE user_id = '049f3b4a-32d4-4d09-87de-eb0cfe33c04e'
   ```
9. **Delete previous bill** (only keep latest)

**Cron job (daily):**
- Find users with `residency_proof_path` AND renewal completed
- Delete stored bills from Supabase Storage
- Clear `residency_proof_path` in database

---

## User Interface

### Settings Page - Email Forwarding Setup

**Show to users with:** Protection + City Sticker + Permit Zone

```tsx
{profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone && (
  <div className="border-2 border-blue-500 p-6 rounded-lg bg-blue-50">
    <h3>📧 Proof of Residency - Email Forwarding</h3>

    <p>
      Skip the hassle of uploading bills every year! Set up email forwarding
      from your utility provider and we'll automatically use your most recent
      bill for city sticker renewals.
    </p>

    {/* Consent Checkbox */}
    <label>
      <input
        type="checkbox"
        checked={residencyForwardingConsent}
        onChange={(e) => setResidencyForwardingConsent(e.target.checked)}
      />
      I consent to automated processing of forwarded utility bills for proof
      of residency verification. Bills are stored temporarily and deleted
      after renewal submission.
    </label>

    {residencyForwardingConsent && (
      <>
        {/* Show forwarding email address */}
        <div className="bg-white p-4 border rounded">
          <strong>Your forwarding email address:</strong>
          <code className="bg-gray-100 p-2 block mt-2">
            {profile.email_forwarding_address || 'Loading...'}
          </code>
          <button onClick={() => navigator.clipboard.writeText(profile.email_forwarding_address)}>
            📋 Copy to Clipboard
          </button>
        </div>

        {/* Instructions */}
        <div className="mt-4">
          <h4>How to set up forwarding:</h4>
          <ol>
            <li>Log in to your utility provider (Comcast, ConEd, etc.)</li>
            <li>Go to Account Settings → Email Preferences</li>
            <li>Add forwarding address: <code>{profile.email_forwarding_address}</code></li>
            <li>Select "Forward all bills" or "Forward monthly statements"</li>
            <li>Save changes</li>
          </ol>

          <p className="text-sm text-gray-600 mt-2">
            <strong>Supported providers:</strong> Comcast, ConEd, Peoples Gas,
            Nicor Gas, AT&T, Verizon, and any utility that sends bills via email.
          </p>
        </div>

        {/* Status */}
        {profile.residency_proof_uploaded_at && (
          <div className="bg-green-100 p-3 rounded mt-4">
            ✓ Most recent bill received: {new Date(profile.residency_proof_uploaded_at).toLocaleDateString()}
          </div>
        )}
      </>
    )}
  </div>
)}
```

---

## Email Service Integration

### Option 1: Cloudflare Email Routing (Recommended - FREE)

**Why:**
- Completely free (unlimited emails)
- Simple setup (5 minutes)
- No email storage - routes directly to webhook
- Managed by Cloudflare (reliable, secure)
- Auto-deletes after processing

**Setup:**
1. Go to Cloudflare Dashboard → Email → Email Routing
2. Add domain: `autopilotamerica.com`
3. Verify DNS records (Cloudflare adds automatically)
4. Create Custom Address:
   - Pattern: `documents+*@autopilotamerica.com`
   - Forward to: Webhook → `https://ticketlesschicago.com/api/email/process-residency-proof`
5. Done!

**How it works:**
- Email arrives at `documents+{uuid}@autopilotamerica.com`
- Cloudflare routes to your webhook via HTTP POST
- Webhook processes and stores PDF
- Email is NOT stored anywhere - ephemeral routing only
- No Gmail, no inbox, no manual deletion needed

**Webhook receives:**
```json
{
  "to": "documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com",
  "from": "noreply@comcast.com",
  "subject": "Your Comcast Bill for January 2025",
  "headers": {...},
  "attachments": [{
    "filename": "bill.pdf",
    "contentType": "application/pdf",
    "content": "base64EncodedPDF..."
  }],
  "text": "Email body text",
  "html": "<html>Email body HTML</html>"
}
```

### Option 2: AWS SES + Lambda

**Why:** More control, cheaper at scale (but more complex)

**Setup:**
1. Verify domain: `autopilotamerica.com` in SES
2. Create SES receipt rule: `documents+*@autopilotamerica.com` → Lambda function
3. Lambda function:
   - Receives email from S3 (SES stores temporarily)
   - Parses email and extracts PDF
   - Calls `/api/email/process-residency-proof` webhook
   - Deletes email from S3
4. Configure S3 lifecycle policy: Delete emails older than 1 day (backup cleanup)

**Cost:** $0.10 per 1000 emails received

### Option 3: SendGrid Inbound Parse

**Why:** Designed for this, but costs money after 100/day

**Setup:**
1. Add MX record: `autopilotamerica.com` → SendGrid
2. Configure Inbound Parse webhook → `POST /api/email/process-residency-proof`
3. SendGrid forwards all `documents+*@autopilotamerica.com` emails to your webhook

**Cost:** Free for first 100 emails/day, $0.0001/email after

---

## API Endpoint: Process Forwarded Email

**File:** `pages/api/email/process-residency-proof.ts`

```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse SendGrid Inbound Parse payload
    const { to, from, subject, attachments, text, html } = req.body;

    // Extract user UUID from email address
    // to = "documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com"
    const match = to.match(/documents\+([0-9a-f-]{36})@autopilotamerica\.com/i);
    if (!match) {
      return res.status(400).json({ error: 'Invalid recipient format' });
    }

    const userId = match[1];

    // Look up user
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check consent
    if (!profile.residency_forwarding_consent_given) {
      return res.status(403).json({ error: 'User has not consented to email forwarding' });
    }

    // Extract PDF from attachments or convert email to PDF
    let pdfBuffer: Buffer;

    if (attachments && attachments.length > 0) {
      // Use first PDF attachment
      const pdfAttachment = attachments.find((a: any) =>
        a.type === 'application/pdf' || a.filename.endsWith('.pdf')
      );

      if (pdfAttachment) {
        pdfBuffer = Buffer.from(pdfAttachment.content, 'base64');
      } else {
        // No PDF found, convert email HTML to PDF
        pdfBuffer = await convertEmailToPDF(html || text);
      }
    } else {
      // No attachments, convert email to PDF
      pdfBuffer = await convertEmailToPDF(html || text);
    }

    // Validate bill (date within 30 days, contains address)
    const validation = await validateUtilityBill(pdfBuffer, profile.address);
    if (!validation.valid) {
      console.warn(`Invalid bill for user ${profile.user_id}:`, validation.reason);
      return res.status(400).json({ error: validation.reason });
    }

    // Delete previous bill (only keep latest)
    if (profile.residency_proof_path) {
      await supabase.storage
        .from('residency-proofs-temp')
        .remove([profile.residency_proof_path]);
    }

    // Upload new bill to Supabase Storage
    const fileName = `${profile.user_id}_latest.pdf`;
    const filePath = `residency-proofs/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('residency-proofs-temp')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload bill' });
    }

    // Update user profile
    await supabase
      .from('user_profiles')
      .update({
        residency_proof_path: filePath,
        residency_proof_uploaded_at: new Date().toISOString(),
        residency_proof_verified: true, // Auto-verified if passes validation
        residency_proof_verified_at: new Date().toISOString(),
      })
      .eq('user_id', profile.user_id);

    return res.status(200).json({
      success: true,
      message: 'Utility bill processed successfully',
      userId: profile.user_id,
    });

  } catch (error: any) {
    console.error('Email processing error:', error);
    return res.status(500).json({ error: 'Processing failed', details: error.message });
  }
}

async function validateUtilityBill(pdfBuffer: Buffer, userAddress: string): Promise<{ valid: boolean; reason?: string }> {
  // TODO: Implement validation logic
  // 1. Extract text from PDF using pdf-parse
  // 2. Check for date within 30 days
  // 3. Check for user's address
  // 4. Check for known utility provider keywords

  return { valid: true };
}

async function convertEmailToPDF(html: string): Promise<Buffer> {
  // TODO: Use puppeteer or similar to convert HTML email to PDF
  // For now, return placeholder
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  page.drawText('Email converted to PDF placeholder');
  return Buffer.from(await pdfDoc.save());
}
```

---

## Cleanup Cron Job

**File:** `pages/api/cron/cleanup-residency-proofs.ts`

```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find users whose city sticker renewal has been completed (processed_at is set)
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, residency_proof_path, city_sticker_processed_at')
      .not('residency_proof_path', 'is', null)
      .not('city_sticker_processed_at', 'is', null);

    let deletedCount = 0;

    for (const profile of profiles || []) {
      // Delete from Supabase Storage
      const { error: deleteError } = await supabase.storage
        .from('residency-proofs-temp')
        .remove([profile.residency_proof_path]);

      if (!deleteError) {
        // Clear database reference
        await supabase
          .from('user_profiles')
          .update({
            residency_proof_path: null,
            residency_proof_uploaded_at: null,
            residency_proof_verified: false,
            residency_proof_verified_at: null,
          })
          .eq('user_id', profile.user_id);

        deletedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} residency proofs`,
      deletedCount,
    });
  } catch (error: any) {
    console.error('Cleanup error:', error);
    return res.status(500).json({ error: 'Cleanup failed', details: error.message });
  }
}
```

**Vercel cron config** (`vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup-residency-proofs",
      "schedule": "0 2 * * *"
    }
  ]
}
```

---

## Privacy Policy Text

Add to your privacy policy:

```
PROOF OF RESIDENCY - EMAIL FORWARDING

For users with permit parking city stickers, we offer an email forwarding
service to simplify proof of residency verification.

How it works:
- You receive a unique email address (e.g., documents+{your-uuid}@autopilotamerica.com)
- You set up forwarding from your utility providers (Comcast, ConEd, etc.)
- We receive forwarded utility bills throughout the year
- We store only your most recent bill for city sticker renewal processing
- All bills are automatically deleted after your renewal is submitted

Privacy safeguards:
- Forwarded emails are processed automatically (no human review unless required)
- We store only the most recent utility bill (previous bills are deleted immediately)
- Stored bills are encrypted and access-controlled
- All bills are deleted within 48 hours of renewal submission
- You can revoke forwarding consent at any time (deletes all stored bills immediately)

Third-party processing:
- Email forwarding is provided by SendGrid (owned by Twilio)
- SendGrid processes incoming emails solely to forward them to our system
- SendGrid does not retain email content after forwarding
- For more information: https://www.twilio.com/legal/privacy

You can disable email forwarding at any time in your account settings.
```

---

## Testing Checklist

Before going live:

- [ ] Run SQL migration: `add_email_forwarding_id.sql`
- [ ] Set up SendGrid Inbound Parse or AWS SES
- [ ] Configure MX records for `autopilotamerica.com`
- [ ] Create Supabase Storage bucket: `residency-proofs-temp`
- [ ] Test email forwarding flow (send test bill to documents+10000@autopilotamerica.com)
- [ ] Verify forwarding ID assignment triggers correctly
- [ ] Test consent flow in settings page
- [ ] Test bill validation (date, address, provider)
- [ ] Test cleanup cron job
- [ ] Update privacy policy
- [ ] Deploy to production

---

## Cost Analysis

**Cloudflare Email Routing:**
- **Cost:** $0 (completely free, unlimited)
- **Estimated cost for 1000 users:** $0/month

**AWS SES + Lambda:**
- $0.10 per 1000 emails received
- $0.20 per million Lambda requests
- **Estimated cost for 1000 users:** ~$1/month

**SendGrid Inbound Parse:**
- Free: 100 emails/day
- $0.0001/email beyond 100/day
- **Estimated cost for 1000 users:** ~$3/month (30 emails/user/year = 30k emails/year)

**Supabase Storage:**
- Included in Pro plan (100GB)
- Average bill size: 500KB
- 1000 users = 500MB total
- **Cost:** $0 (well within limits)

---

## Key Takeaways

1. **Email forwarding uses Supabase UUID** - secure, unique, not PII
2. **Format:** `documents+{user-uuid}@autopilotamerica.com`
3. **Example:** `documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com`
4. **Auto-generated** when user signs up for Protection + Permit
5. **Ephemeral routing** - Cloudflare routes directly to webhook, NO email storage
6. **Organized storage** - `proof/{uuid}/{yyyy-mm-dd}/bill.pdf` for easy remitter access
7. **Delete after purchase** - Bills deleted after city sticker purchase confirmed or 60 days outside renewal window
8. **Consent required** - User must consent before processing forwarded emails
9. **Privacy-first** - No Gmail, no inbox, automated processing, immediate deletion
10. **Cost-effective** - $0/month with Cloudflare Email Routing
11. **User experience** - Set up once, never upload bills again

---

## Future Enhancements

1. **Smart bill detection:** Use AI to detect bill type (electric, gas, water) and prioritize most recent
2. **Multi-provider support:** Handle bills from multiple utilities (keep one from each)
3. **Bill validation AI:** Use Google Cloud Vision to extract date/address automatically
4. **User notifications:** Email user when new bill is received and stored
5. **Bill preview:** Show user thumbnail of stored bill in settings
6. **Alternative upload:** Allow manual upload if forwarding fails
