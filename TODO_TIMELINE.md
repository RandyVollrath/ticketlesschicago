# Development Timeline & Task Breakdown

## 🚀 STRIPE CONNECT TESTING
**Time Estimate: 30-60 minutes**

### Quick Path (30 min):
1. Run checker script (2 min)
2. Create test connected account (5 min)
3. Generate onboarding link (2 min)
4. Complete onboarding (10 min)
5. Test a payment (5 min)
6. Verify transfer worked (5 min)

### Full Testing (60 min):
- All of above PLUS
- Test webhook events
- Test disconnecting accounts
- Test different account types
- Document integration points

**Priority: MEDIUM** - Need this for remitter payments

---

## 💰 PAYMENT VERIFICATION & PRICING

### 1. Charging Correct Amount on Every Page
**Time Estimate: 2-3 hours**

**Tasks:**
- [ ] Audit all pricing variables in codebase
- [ ] Create pricing config file (single source of truth)
- [ ] Update all payment flows to use config
- [ ] Test each payment type:
  - [ ] City sticker ($151 passenger, varies by type)
  - [ ] License plate renewal ($151)
  - [ ] Permit fees (varies by zone)
  - [ ] Protection subscription ($7/mo or $70/yr)
  - [ ] Vanity plate fees (+$13)
  - [ ] Personalized plate fees (+$7)
- [ ] Verify Stripe price IDs match amounts
- [ ] Check test mode vs live mode pricing

**Current Issues to Check:**
```bash
# Check all hardcoded prices
grep -r "\$151\|\$7\|\$70\|151" pages/ components/ --include="*.tsx" --include="*.ts"

# Check Stripe price IDs
grep -r "price_" .env.local
```

**Priority: HIGH** - Money stuff can't be wrong

---

### 2. Clarify Terms for Ticket Protection
**Time Estimate: 1 hour**

**Tasks:**
- [ ] Review current terms on /protection page
- [ ] Add clear FAQs about:
  - [ ] What's covered (parking tickets, not moving violations)
  - [ ] Reimbursement limits (80% up to $200/year)
  - [ ] How reimbursement works (submit ticket, get paid)
  - [ ] What's NOT covered (towing, boots, moving violations)
  - [ ] Renewal reminder specifics
  - [ ] Cancellation policy
- [ ] Add terms acceptance checkbox to signup
- [ ] Link to full Terms of Service

**Priority: HIGH** - Legal/clarity issue

---

## 📸 DRIVER'S LICENSE VALIDATION TESTING

### 3. Test with Faulty Images
**Time Estimate: 30 minutes**

**Test Cases:**
- [ ] Blurry image (should fail Google Vision OCR)
- [ ] Dark/underexposed image
- [ ] Glare/overexposed image
- [ ] Non-driver's license (passport, random photo)
- [ ] Cut-off image (missing parts)
- [ ] Low resolution image (<800x600)

**How to Test:**
```bash
# I can create a test script that uploads different image types
# and shows you which ones pass/fail validation
node test-license-validation.js
```

**Current Validation:**
- ✅ Google Vision API checks OCR readability
- ✅ Looks for keywords: "license", "driver", "DL", "DOB", "expires"
- ✅ Rejects if no text detected
- ✅ Checks for document type
- ⚠️ Sharp validation disabled (was causing issues)

**Priority: MEDIUM** - Good to verify, but Google Vision should handle it

---

## 📧 UTILITY BILL AUTOMATION

### 4. Set Up Bills from All Utilities
**Time Estimate: 30 minutes**

**Your forwarding address:** `8777a96d-dfdc-48ab-9dd2-182c9e34080a@bills.autopilotamerica.com`

**Utilities to Set Up:**
- [ ] ComEd (Commonwealth Edison)
- [ ] Peoples Gas
- [ ] Xfinity/Comcast
- [ ] Water bill (if separate)
- [ ] Any other utilities

**Steps for each:**
1. Log into utility account
2. Go to billing/notifications settings
3. Add forwarding email as secondary email
4. Verify email if needed
5. Test by requesting a bill

**Priority: MEDIUM** - Nice automation, not critical

---

### 5. Auto-Delete Bills from Email
**Time Estimate: 1-2 hours**

**Options:**

**Option A: Gmail Filter (Quick - 15 min)**
```
1. Go to Gmail Settings → Filters
2. Create filter:
   - From: bills.autopilotamerica.com
   - Skip Inbox, Auto-delete after 30 days
```

**Option B: Email Provider Automation (Medium - 1 hour)**
- Set up email rule to auto-forward AND delete
- Works with Gmail, Outlook, etc.

**Option C: Build Custom Email Handler (Long - 2 hours)**
- Use IMAP to auto-delete after processing
- More control but more complex

**Priority: LOW** - Manual deletion works fine for now

---

### 6. Go Through Proof of Residency Setup
**Time Estimate: 30 minutes**

**Test Flow:**
- [ ] Visit /settings as user WITHOUT permit zone
  - Should NOT see proof of residency section
- [ ] Visit /settings as user WITH permit zone
  - Should see email forwarding setup
  - Should see most recent bill
  - Should show upload status
- [ ] Upload a test bill manually
- [ ] Verify bill is stored correctly
- [ ] Check bill expiration (30 days)
- [ ] Test email forwarding integration

**Priority: HIGH** - Core feature for permit zone users

---

## 🔒 SECURITY & DATA RETENTION

### 7. Finalize Position on Ephemeral Storage
**Time Estimate: 2-3 hours**

**Current Setup:**
- Driver's license: Stored in `license-images-temp` bucket
- Utility bills: Stored in `residency-proofs-temps` bucket (I assume)
- Both have "temp" in the name but are they actually ephemeral?

**Questions to Answer:**
1. **How long should licenses be stored?**
   - Current: User chooses (48 hours OR until license expires)
   - Recommendation: Keep this, it's good

2. **How long should bills be stored?**
   - Current: Should be 30 days (most recent bill only)
   - Need to verify auto-cleanup is working

3. **What's your legal defense for storing this data?**
   ```
   Option A: "We're an authorized agent processing renewals on your behalf"
   Option B: "We're a convenience service, you control retention"
   Option C: "We're like a personal filing cabinet, you give us permission"
   ```

4. **What happens if subpoenaed?**
   - Do you decrypt and provide?
   - Do you have the decryption keys?
   - What's in your privacy policy?

**Action Items:**
- [ ] Review privacy policy
- [ ] Add clear data retention policy
- [ ] Verify encryption is working
- [ ] Set up auto-cleanup cron jobs
- [ ] Add "delete my data" button
- [ ] Document legal position
- [ ] Consult with lawyer if needed

**Priority: HIGH** - Legal/security issue

---

## 👥 PERMIT ZONE VISIBILITY

### 8. Show License/Bills Only to Permit Zone Users
**Time Estimate: 1 hour**

**Current Implementation:**
```tsx
{profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone && (
  <div id="license-upload">
    // License upload section
  </div>
)}
```

**Looks correct!** But let's verify:

**Test Cases:**
- [ ] User WITHOUT permit zone → Should NOT see upload sections
- [ ] User WITH permit zone but NO protection → Should NOT see
- [ ] User WITH permit zone AND protection → SHOULD see
- [ ] User WITH permit zone, protection, but NO city sticker expiry → Should NOT see

**Also check:**
- [ ] DocumentStatus component (shows at top)
- [ ] Email forwarding section
- [ ] License access history
- [ ] All related UI components

**Priority: HIGH** - Privacy issue if shown to wrong users

---

## 💳 PAYMENT TESTING

### 9. Test Remitter City Sticker Payments
**Time Estimate: 2-3 hours**

**Prerequisites:**
- Stripe Connect working (see task #1)
- Connected account for remitter created
- Onboarding completed

**Test Flow:**
1. **As Platform (You):**
   - [ ] Create connected account for remitter
   - [ ] Generate onboarding link
   - [ ] Send to remitter
   - [ ] Verify remitter completes onboarding

2. **As User:**
   - [ ] Select city sticker renewal
   - [ ] Choose plate type (passenger, motorcycle, etc.)
   - [ ] Enter vehicle details
   - [ ] Upload license (if permit zone)
   - [ ] Upload proof of residency (if permit zone)
   - [ ] Review order
   - [ ] Enter payment info
   - [ ] Submit payment

3. **Verify:**
   - [ ] Payment goes to remitter's connected account
   - [ ] Platform fee is taken (if applicable)
   - [ ] User gets confirmation email
   - [ ] Remitter gets notification
   - [ ] Data is stored correctly
   - [ ] Documents are attached to order

**Priority: CRITICAL** - Core business function

---

### 10. Test License Plate Renewal Payments
**Time Estimate: 1-2 hours**

**Similar to city sticker but simpler:**
- [ ] No document uploads needed
- [ ] Fixed price ($151 for most)
- [ ] Verify payment flow
- [ ] Check Stripe price IDs
- [ ] Test different plate types
- [ ] Verify remitter receives payment

**Priority: HIGH** - Core feature

---

## 📊 TOTAL TIME ESTIMATES

### Must Do Before Launch:
1. **Payment verification** (3 hours) - HIGH
2. **Terms clarity** (1 hour) - HIGH
3. **Permit zone visibility check** (1 hour) - HIGH
4. **Data retention policy** (3 hours) - HIGH
5. **Proof of residency flow test** (30 min) - HIGH

**Subtotal: ~8.5 hours (1 full work day)**

### Important But Can Wait:
6. **Stripe Connect testing** (1 hour) - MEDIUM
7. **Remitter payment testing** (3 hours) - CRITICAL but needs Connect first
8. **License plate payment testing** (2 hours) - HIGH

**Subtotal: ~6 hours**

### Nice to Have:
9. **License validation testing** (30 min) - MEDIUM
10. **Utility bill setup** (30 min) - MEDIUM
11. **Email auto-delete** (1 hour) - LOW

**Subtotal: ~2 hours**

## 🎯 RECOMMENDED ORDER

### Day 1 (Today): Foundation (8-9 hours)
1. Payment verification & pricing audit
2. Terms clarity
3. Permit zone visibility check
4. Data retention policy
5. Proof of residency flow test
6. Stripe Connect setup & testing

### Day 2: Payment Testing (5-6 hours)
7. Remitter city sticker payment testing
8. License plate renewal payment testing
9. End-to-end user flow testing

### Day 3: Polish (2-3 hours)
10. License validation testing
11. Utility bill setup
12. Final QA pass

## 🚨 BLOCKERS & DEPENDENCIES

- **Can't test remitter payments** until Stripe Connect is working
- **Can't launch** until payment amounts are verified
- **Legal risk** until data retention policy is finalized
- **Privacy issue** if permit zone content shows to wrong users

---

**Want me to start with any specific task?** I'd recommend starting with the payment verification since that's the highest risk.
