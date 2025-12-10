# CRITICAL Security Issues Found - Action Required

## 🚨 MOST URGENT (Fix TODAY)

### 1. PUBLIC PERMIT DOCUMENTS - CRITICAL ⚠️

**File**: `pages/api/permit-zone/upload-documents.ts` (lines 194, 203)
**Issue**: Government IDs and proof of residency uploaded with `access: 'public'`

```typescript
// CURRENT (INSECURE):
const blob = await put(
  `permit-docs/${userId}/id-${timestamp}...`,
  idDocument.data,
  {
    access: 'public',  // ❌ ANYONE CAN ACCESS!
```

**Who can see**: Anyone who knows/guesses a user ID can download their government ID

**Fix**:
```typescript
// CHANGE TO:
{
  access: 'private',  // ✅ Requires authentication
```

---

### 2. MISSING AUTHENTICATION ON ADMIN ENDPOINTS - CRITICAL ⚠️

**File**: `pages/api/admin/update-user.ts`
**Issue**: NO authentication check - anyone can update any user's data

```typescript
// CURRENT (INSECURE):
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user_id, updates } = req.body;
  // ❌ No auth check! Anyone can call this!
```

**Who can exploit**: Anyone with internet access

**Fix**: Add authentication:
```typescript
const authHeader = req.headers.authorization;
if (!authHeader?.startsWith('Bearer ')) {
  return res.status(401).json({ error: 'Unauthorized' });
}

const token = authHeader.substring(7);
const { data: { user }, error } = await supabase.auth.getUser(token);

if (error || !user) {
  return res.status(401).json({ error: 'Unauthorized' });
}

// Verify user is admin
const { data: profile } = await supabase
  .from('user_profiles')
  .select('is_admin')
  .eq('user_id', user.id)
  .single();

if (!profile?.is_admin) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

---

### 3. ANYONE CAN ACCESS ALL USER OBLIGATIONS - CRITICAL ⚠️

**File**: `pages/api/check-reminders.ts`
**Issue**: Returns ALL users' renewal reminders with no authentication

```typescript
// CURRENT (INSECURE):
const { data: obligations } = await supabaseAdmin
  .from('upcoming_obligations')
  .select('*')  // ❌ Returns EVERYONE's data!
```

**Data exposed**: Every user's license plate, address, renewal dates, contact info

**Fix**: Delete this endpoint or add authentication + user filtering

---

### 4. MISSING WEBHOOK SIGNATURE VERIFICATION - HIGH ⚠️

**Files**:
- `pages/api/webhooks/resend-incoming-email.ts`
- `pages/api/webhooks/clicksend-incoming-sms.ts`

**Issue**: Webhooks accept any request with no signature verification

**Risk**: Attacker can inject fake emails/SMS, create false user records

**Fix**:
```typescript
// Add signature verification
const signature = req.headers['x-resend-signature'] as string;
const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

if (!verifySignature(req.body, signature, webhookSecret)) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

### 5. HARDCODED ADMIN PASSWORD IN FRONTEND - HIGH ⚠️

**File**: `pages/admin.tsx` (line 35)

```typescript
if (password === 'ticketless2025admin') {  // ❌ Visible in source code!
  setAuthenticated(true);
}
```

**Who can see**: Anyone who views page source

**Fix**: Remove client-side password auth entirely, use proper authentication

---

## 💡 ENCRYPTION EXPLAINED FOR CUSTOMERS

### Simple Answer:

> "Your documents are encrypted, like keeping them in a locked safe. We hold the key to that safe so we can send your documents to the city when you request a renewal. We only unlock the safe when you authorize us to, and all access is logged so you can see who viewed your documents and when."

### Technical Truth:

**What's encrypted:**
- ✅ **In transit** (100%): HTTPS/TLS encrypts all uploads/downloads
- ✅ **At rest** (Supabase default): AWS encrypts disks with AES-256

**Who has the keys:**
- We have the encryption keys (not you)
- This is necessary so we can send files to the city
- Similar to how your bank encrypts your data but can still access it

**Customer-managed keys:**
- Since you're on paid Supabase, you CAN enable customer-managed keys
- This would mean even Supabase can't access files without your permission
- But it complicates the remitter access flow

---

## 📊 TICKET PHOTOS - What to Tell Users

**For Privacy Policy:**

> **Ticket Photos:**
> Parking ticket photos are stored securely in private, encrypted storage and retained indefinitely for analytics, dispute resolution, and to verify reimbursement claims. We analyze aggregate ticket data to identify enforcement patterns and help you contest unfair tickets.
>
> Your ticket photos contain your license plate, vehicle information, and ticket details. They are never made public and are only accessible to you and authorized personnel processing your reimbursement claims.
>
> You can request deletion of your ticket photos at any time by contacting support. Note that deleting ticket photos may affect your ability to contest tickets or receive reimbursements.

**Why keep tickets indefinitely:**
- Valuable for contesting tickets (FOIA requests need historical data)
- Analytics show enforcement patterns
- Verify legitimate reimbursements
- Now that bucket is PRIVATE, security risk is low

---

## ✅ WHAT'S ALREADY SECURE

1. ✅ Audit logging system exists (`audit_logs` table + `lib/audit-logger.ts`)
2. ✅ License images bucket is PRIVATE
3. ✅ Bills bucket is PRIVATE
4. ✅ Ticket photos bucket NOW PRIVATE (we just fixed it)
5. ✅ Auto-deletion crons are configured
6. ✅ HTTPS/TLS encryption in transit

---

## 🎯 IMMEDIATE ACTION PLAN

### Step 1: Fix Public Documents (5 min)

```bash
# Search for all instances of access: 'public'
grep -r "access.*public" pages/api --include="*.ts"

# Change to access: 'private' in:
# - pages/api/permit-zone/upload-documents.ts
# - pages/api/webhooks/clicksend-incoming-sms.ts
# - Any other upload endpoints
```

### Step 2: Add Auth to Admin Endpoints (30 min)

Create `lib/auth-middleware.ts`:
```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function requireAuth(req: NextApiRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No authorization header');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error('Invalid token');
  }

  return user;
}

export async function requireAdmin(req: NextApiRequest) {
  const user = await requireAuth(req);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .single();

  if (!profile?.is_admin) {
    throw new Error('Admin access required');
  }

  return { user, profile };
}
```

Then use in endpoints:
```typescript
import { requireAdmin } from '@/lib/auth-middleware';

export default async function handler(req, res) {
  try {
    await requireAdmin(req);
    // ... rest of endpoint
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
}
```

### Step 3: Add Audit Logging to Sensitive Endpoints (1 hour)

In `pages/api/protection/upload-license.ts`:
```typescript
import { logAuditEvent, getIpAddress, getUserAgent } from '@/lib/audit-logger';

// After successful upload:
await logAuditEvent({
  userId: user.id,
  actionType: 'document_uploaded',
  entityType: 'permit_document',
  entityId: filePath,
  actionDetails: {
    documentType: side === 'front' ? 'license_front' : 'license_back',
    fileName: file.originalFilename,
    size: file.size,
  },
  status: 'success',
  ipAddress: getIpAddress(req),
  userAgent: getUserAgent(req),
});
```

### Step 4: Add Security FAQ to Settings (30 min)

I'll implement this in the next step.

---

## 🔥 FILES TO FIX IMMEDIATELY

1. `pages/api/permit-zone/upload-documents.ts` - Change `access: 'public'` → `'private'`
2. `pages/api/webhooks/clicksend-incoming-sms.ts` - Change `access: 'public'` → `'private'`
3. `pages/api/admin/update-user.ts` - Add authentication
4. `pages/api/check-reminders.ts` - Delete or add auth + filtering
5. `pages/api/webhooks/*.ts` - Add signature verification
6. `pages/admin.tsx` - Remove hardcoded password

---

**Want me to implement these fixes now?**
