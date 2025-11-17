# Remitter Confirmation Workflow

## 🚨 Critical Problem Solved

**Old Logic (BROKEN):**
```
If (14-29 days until expiry):
  → Tell user "We already purchased your renewal"
```

This assumed purchase happened, even if it didn't!

**New Logic (CORRECT):**
```
If (14-29 days until expiry AND city_payment_status = 'paid'):
  → Tell user "We already purchased your renewal"
Else:
  → Tell user "We're processing your renewal"
```

Now we only say "already purchased" if we have city confirmation!

---

## 📊 Database Schema

### `renewal_payments` Table

```sql
CREATE TABLE renewal_payments (
  id UUID PRIMARY KEY,
  user_id UUID,
  renewal_type TEXT, -- 'city_sticker' or 'license_plate'

  -- Payment tracking
  stripe_payment_intent_id TEXT,
  payment_status TEXT, -- 'pending', 'paid', 'failed', 'refunded'

  -- City confirmation (THIS IS THE KEY)
  city_payment_status TEXT, -- 'pending', 'paid', 'failed'
  city_confirmation_number TEXT,

  -- Dates
  due_date DATE,
  paid_at TIMESTAMP,
  created_at TIMESTAMP
);
```

**Key Fields:**
- `payment_status` = Customer paid US
- `city_payment_status` = We paid the CITY (this is what matters!)
- `city_confirmation_number` = Tracking/confirmation from city

---

## 🔄 Complete Workflow

### Step 1: User Charge (30 days before expiry)

**Trigger:** Cron job at 30 days before expiry

**Action:**
1. Charge user's card via Stripe
2. Create record in `renewal_payments`:
   ```sql
   INSERT INTO renewal_payments (
     user_id,
     renewal_type,
     payment_status = 'paid',
     city_payment_status = 'pending', -- NOT YET PAID TO CITY
     due_date
   )
   ```

**Notification:**
```
"We're charging your card TODAY for your City Sticker renewal"
```

---

### Step 2: Remitter Processing (Manual/Automated)

**Who:** Remitter (person/service that submits to city)

**What they need:**
1. User's profile information (VIN, plate, address)
2. Driver's license (for permit zones)
3. Proof of residency (for permit zones)

**Access via API:**
```javascript
// Get pending renewals
GET /api/renewals/pending
// Returns list of users whose payment_status='paid'
// but city_payment_status='pending'

// Get user documents
GET /api/city-sticker/get-driver-license?userId={uuid}
GET /api/city-sticker/get-residency-proof?userId={uuid}

// Get user profile
GET /api/user-profile?userId={uuid}
```

**Remitter submits to city website** (currently manual)

---

### Step 3: City Confirmation (THIS IS THE MISSING PIECE)

**Problem:** Currently manual and variable timing

**Options for getting confirmation:**

#### Option A: Remitter Manual Confirmation (Current)
Remitter logs into portal and updates:
```javascript
POST /api/renewals/confirm-city-payment
{
  "renewal_payment_id": "uuid",
  "city_confirmation_number": "CHI-12345678",
  "city_payment_status": "paid"
}
```

This updates the database:
```sql
UPDATE renewal_payments
SET
  city_payment_status = 'paid',
  city_confirmation_number = 'CHI-12345678'
WHERE id = 'renewal_payment_id'
```

#### Option B: City API Integration (Future)
If city provides an API, we could:
1. Submit renewal programmatically
2. Get immediate confirmation
3. Auto-update `city_payment_status`

#### Option C: Email Scraping (Hacky but works)
If city sends confirmation emails:
1. Forward confirmation emails to your system
2. Parse for confirmation number
3. Auto-update database

---

### Step 4: User Notification (14-29 days before expiry)

**Trigger:** Daily cron checks reminder days

**New Logic:**
```javascript
// Check if city payment is confirmed
const { data: payment } = await supabase
  .from('renewal_payments')
  .select('*')
  .eq('user_id', userId)
  .eq('renewal_type', 'city_sticker')
  .eq('city_payment_status', 'paid') // ← THE KEY CHECK
  .single();

if (payment) {
  // We have confirmation!
  message = "Good news! We already purchased your City Sticker";
} else {
  // No confirmation yet
  message = "We're processing your renewal purchase";
}
```

---

## 🛠️ Remitter Portal Features Needed

### Dashboard View

```
Pending Renewals (5)
┌─────────────────────────────────────────────────────────┐
│ Randy Vollrath                                          │
│ License: IL ABC123 | Due: Dec 15, 2025                 │
│ Charged: Nov 15 | City Payment: PENDING                │
│ [View Documents] [Mark as Submitted]                    │
└─────────────────────────────────────────────────────────┘
```

### Submission Workflow

1. **Click "View Documents"**
   - Downloads driver's license
   - Downloads proof of residency
   - Shows profile data (VIN, plate, address)

2. **Submit to City Website**
   - Remitter manually enters data
   - Gets confirmation number from city

3. **Click "Mark as Submitted"**
   - Enter city confirmation number
   - System updates `city_payment_status = 'paid'`
   - Triggers notification to user

---

## 📱 API Endpoints Needed

### For Remitter Portal

```typescript
// Get all pending renewals
GET /api/remitter/pending-renewals
Response: [
  {
    renewal_payment_id: "uuid",
    user: {
      name: "Randy Vollrath",
      email: "randy@example.com",
      license_plate: "ABC123",
      state: "IL",
      vin: "1HGBH41JXMN109186"
    },
    renewal_type: "city_sticker",
    due_date: "2025-12-15",
    charged_at: "2025-11-15",
    has_documents: true
  }
]

// Mark as submitted to city
POST /api/remitter/confirm-submission
Body: {
  renewal_payment_id: "uuid",
  city_confirmation_number: "CHI-12345678",
  notes: "Submitted via city website"
}
```

### For Automated City Submission (Future)

```typescript
// Submit renewal to city API
POST /api/city/submit-renewal
Body: {
  renewal_payment_id: "uuid",
  // ... user data
}
Response: {
  confirmation_number: "CHI-12345678",
  status: "success"
}
```

---

## ⏱️ Timing Considerations

**Best Case (Automated):**
- Day 0: User charged, city payment immediate
- Day 1: Confirmation received, user notified "already purchased"

**Realistic Case (Manual Remitter):**
- Day 0: User charged at 30 days before expiry
- Day 1-7: Remitter batches and submits to city
- Day 8: Confirmation received
- Day 8+: Users start getting "already purchased" messages

**Worst Case (Delayed):**
- Day 0: User charged
- Day 14: Still no confirmation (user gets "we're processing" message)
- Day 20: Finally confirmed
- Day 21: User gets "already purchased" message

---

## 🚨 Edge Cases

### What if remitter never confirms?

**User sees:**
```
"We're processing your renewal. Please contact support if you have questions."
```

**Action needed:**
- Check renewal_payments for stuck records
- Contact remitter to confirm status
- Manually update if needed

### What if city submission fails?

**Remitter should mark as failed:**
```sql
UPDATE renewal_payments
SET city_payment_status = 'failed'
WHERE id = 'renewal_payment_id'
```

**User sees:**
```
"There was an issue with your renewal.
Our team is working on it. We'll contact you shortly."
```

### What if user already renewed themselves?

**Check before charging:**
```javascript
// Query city API or check status
if (userAlreadyRenewed) {
  // Skip charge
  // Send confirmation email
  // Update profile
}
```

---

## 📧 Notification Messages Summary

| Days Until Expiry | City Status | Message |
|-------------------|-------------|---------|
| 60, 45 days | N/A | "We'll charge on [DATE]" |
| 37 days | N/A | "We'll charge in 7 days" |
| 30 days | N/A | "Charging your card TODAY" |
| 14-29 days | ✅ Paid | "We already purchased your renewal" |
| 14-29 days | ⏳ Pending | "We're processing your renewal" |
| 1-13 days | ✅ Paid | "Sticker should arrive soon" |
| 1-13 days | ⏳ Pending | "We're working on your renewal" |

---

## 🎯 Implementation Priority

### Phase 1: IMMEDIATE (This PR)
- ✅ Update notification logic to check `city_payment_status`
- ✅ Stop saying "already purchased" without confirmation
- ✅ Add honest "we're processing" messages

### Phase 2: SHORT TERM (Next Week)
- [ ] Build remitter portal dashboard
- [ ] Add API endpoint for remitter to mark submissions
- [ ] Add admin view to monitor stuck renewals

### Phase 3: MEDIUM TERM (Next Month)
- [ ] Explore city API integration (if available)
- [ ] Automate submission where possible
- [ ] Add email confirmation parsing

---

## 🔐 Security Considerations

**Remitter Access:**
- Separate authentication for remitter portal
- Rate limiting on document access endpoints
- Audit logging for all document views
- IP whitelisting for remitter access

**Data Protection:**
- Remitter sees encrypted documents only when needed
- Documents auto-delete after submission
- No permanent storage of sensitive data
- Compliance with CCPA/privacy laws

---

## 💡 Recommendations

1. **Start with Manual Portal**
   - Build remitter dashboard this week
   - Manual submission to city, manual confirmation entry
   - Gets you to accurate notifications immediately

2. **Monitor Timing**
   - Track average time from charge to city confirmation
   - Adjust messaging if delays are consistent
   - Set SLA: "Must confirm within 7 days"

3. **Consider Batch Processing**
   - Remitter submits daily batches
   - Bulk confirmation updates
   - More efficient than one-by-one

4. **Plan for Automation**
   - Research city API availability
   - Contact city clerk's office
   - RPA/scraping as last resort

---

## ✅ Success Metrics

**User Trust:**
- 0% false "already purchased" messages
- < 1% "we're processing" messages (means fast confirmation)
- < 5 support tickets per month about renewal status

**Operational:**
- < 24 hours average time to city confirmation
- > 99% successful submissions
- 0 missed renewals

**Technical:**
- API uptime > 99.9%
- Document access < 500ms
- Confirmation updates real-time

---

This system ensures we NEVER lie to users about purchase status, while still providing helpful updates about the renewal process!
