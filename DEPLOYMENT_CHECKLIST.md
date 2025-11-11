# Complete Deployment Checklist

## Everything You Need to Do (In Order)

### 1. Run SQL Migrations ⚙️

Run these in order in your database:

```bash
# Migration 1: Email Forwarding & Residency Proofs
psql $DATABASE_URL -f database/migrations/add_email_forwarding_id.sql

# Migration 2: License Plate Renewals
psql $DATABASE_URL -f database/migrations/add_license_plate_renewal_support.sql

# Migration 3: License Access Audit Logging
psql $DATABASE_URL -f database/migrations/add_license_access_audit_log.sql
```

**What these do:**
- ✅ Email forwarding addresses (`documents+{uuid}@autopilotamerica.com`)
- ✅ Residency proof storage paths
- ✅ License plate types and auto-calculated renewal costs
- ✅ Complete audit logging for license accesses

---

### 2. Set Up Resend Inbound Webhook 📧

1. Go to https://resend.com/webhooks
2. Click "Add Endpoint"
3. **URL:** `https://ticketlesschicago.com/api/email/process-residency-proof-resend`
4. **Events:** Select `email.received`
5. Click "Save"

6. Configure inbound domain (if not done):
   - Go to Resend → Inbound
   - Add domain: `autopilotamerica.com` (or use Resend's default)
   - Update DNS records as instructed by Resend

**Test it:**
```bash
# Forward a test email with PDF attachment to:
documents+{test-user-uuid}@autopilotamerica.com

# Check Resend logs for webhook delivery
# Check Supabase storage for uploaded bill: proof/{uuid}/{date}/bill.pdf
```

---

### 3. Update Stripe Products (Annual Task) 💳

**You need to update prices manually in Stripe dashboard every year.**

### City Sticker Products (Already Created?)
Based on your code, you have these:
- Motorbike: $53.04
- Passenger: $100.17
- Large Passenger: $159.12
- Small Truck: $235.71
- Large Truck: $530.40

### License Plate Products (You Said You Created These?)
**If you haven't created these Stripe products yet, create them now:**

**Standard Plates:**
- Illinois Passenger Plate: $151.00
- Illinois Motorcycle Plate: $41.00
- Illinois B-Truck Plate: $151.00
- Illinois C-Truck Plate: $218.00
- Illinois Persons w/ Disabilities Plate: $151.00

**Weight-Based Plates:**
- Illinois RT Plate (≤3,000 lbs): $18.00
- Illinois RT Plate (3,001-8,000 lbs): $30.00
- Illinois RT Plate (8,001-10,000 lbs): $38.00
- Illinois RT Plate (10,001+ lbs): $50.00
- Illinois RV Plate (≤8,000 lbs): $78.00
- Illinois RV Plate (8,001-10,000 lbs): $90.00
- Illinois RV Plate (10,001+ lbs): $102.00

**Add-Ons (Optional - depends on your billing model):**
- Personalized Plate Addon: $7.00
- Vanity Plate Addon: $13.00

**Note:** The database auto-calculates these costs for display purposes, but you need Stripe products to actually charge users when renewals are due.

---

### 4. Deploy Code Changes 🚀

```bash
git add .
git commit -m "Add license plate renewals, audit logging, pricing updates, and email forwarding"
git push
```

**What's being deployed:**

**New Files:**
- `pages/api/email/process-residency-proof-resend.ts` - Resend webhook
- `pages/api/license-plate/get-renewal-info.ts` - License plate renewal endpoint
- `components/LicenseAccessHistory.tsx` - Access history UI
- `components/EmailForwardingSetup.tsx` - Email setup guide
- `database/migrations/add_license_access_audit_log.sql` - Audit logging
- `database/migrations/add_license_plate_renewal_support.sql` - License plates

**Modified Files:**
- `pages/settings.tsx` - Added license plate type UI, access history, email forwarding
- `pages/alerts/success.tsx` - Updated consent language, email forwarding prompt
- `pages/protection.tsx` - Updated pricing to $12/month or $120/year (2 months free)
- `pages/api/city-sticker/get-driver-license.ts` - Added audit logging
- `pages/api/cron/cleanup-residency-proofs.ts` - Changed to 31-day deletion
- `database/migrations/add_email_forwarding_id.sql` - Added DROP IF EXISTS

---

### 5. Test Everything 🧪

#### Test 1: Email Forwarding
```bash
# 1. Get test user's forwarding address
psql $DATABASE_URL -c "SELECT email_forwarding_address FROM user_profiles WHERE email = 'test@example.com';"

# 2. Forward test email with PDF to that address
# 3. Check Resend logs
# 4. Check Supabase storage: residency-proofs-temp/proof/{uuid}/{date}/bill.pdf
# 5. Check database updated
psql $DATABASE_URL -c "SELECT residency_proof_path, residency_proof_uploaded_at FROM user_profiles WHERE email = 'test@example.com';"
```

#### Test 2: License Plate Renewal Cost Calculation
```bash
# Update test user with license plate info
psql $DATABASE_URL <<EOF
UPDATE user_profiles
SET license_plate = 'TEST123',
    license_plate_type = 'PASSENGER',
    license_plate_is_personalized = false,
    license_plate_is_vanity = false
WHERE email = 'test@example.com';
EOF

# Should auto-calculate cost to $151.00
psql $DATABASE_URL -c "SELECT license_plate_renewal_cost FROM user_profiles WHERE email = 'test@example.com';"
# Expected: 151.00

# Test with personalized
psql $DATABASE_URL -c "UPDATE user_profiles SET license_plate_is_personalized = true WHERE email = 'test@example.com';"
psql $DATABASE_URL -c "SELECT license_plate_renewal_cost FROM user_profiles WHERE email = 'test@example.com';"
# Expected: 158.00 ($151 + $7)

# Test with vanity
psql $DATABASE_URL -c "UPDATE user_profiles SET license_plate_is_vanity = true WHERE email = 'test@example.com';"
psql $DATABASE_URL -c "SELECT license_plate_renewal_cost FROM user_profiles WHERE email = 'test@example.com';"
# Expected: 164.00 ($151 + $13)
```

#### Test 3: License Access Audit Logging
```bash
# Call license access endpoint
curl "https://ticketlesschicago.com/api/city-sticker/get-driver-license?userId={test-user-uuid}"

# Check audit log
psql $DATABASE_URL -c "SELECT accessed_at, accessed_by, reason FROM license_access_log WHERE user_id = '{test-user-uuid}';"

# Expected output:
# accessed_at          | accessed_by           | reason
# 2025-01-10 14:30:00  | remitter_automation   | city_sticker_renewal

# Visit settings page as test user
# Should see "License Access History" section with the access logged
```

#### Test 4: Access Pattern Detection
```bash
# Simulate multiple accesses (unusual)
curl "https://ticketlesschicago.com/api/city-sticker/get-driver-license?userId={test-user-uuid}"
curl "https://ticketlesschicago.com/api/city-sticker/get-driver-license?userId={test-user-uuid}"
curl "https://ticketlesschicago.com/api/city-sticker/get-driver-license?userId={test-user-uuid}"
curl "https://ticketlesschicago.com/api/city-sticker/get-driver-license?userId={test-user-uuid}"

# Check for unusual pattern alert
psql $DATABASE_URL -c "SELECT * FROM detect_unusual_license_access('{test-user-uuid}');"

# Expected output:
# alert_type           | alert_message                                      | access_count
# high_frequency_24h   | License accessed 4 times in last 24 hours          | 4
```

#### Test 5: Settings Page UI
1. Visit `/settings` as Protection user with permit zone
2. Verify shows:
   - ✅ License plate type dropdown
   - ✅ Weight inputs for RT/RV (if selected)
   - ✅ Personalized/Vanity checkboxes
   - ✅ Calculated renewal cost display
   - ✅ Email forwarding setup section
   - ✅ License access history section (if license uploaded)

#### Test 6: Pricing Page
1. Visit `/protection`
2. Verify shows:
   - ✅ "Annual ($120/yr - 2 months free)"
   - ✅ Consent text mentions "$12/month" or "$120/year"

---

### 6. Monitor Production 📊

#### Check Access Logs Daily (First Week)
```sql
-- See all accesses today
SELECT user_id, accessed_at, accessed_by, reason
FROM license_access_log
WHERE accessed_at::date = CURRENT_DATE
ORDER BY accessed_at DESC;

-- Check for unusual patterns
SELECT user_id, COUNT(*) as access_count
FROM license_access_log
WHERE accessed_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id
HAVING COUNT(*) > 3;
```

#### Check Resend Webhook Logs
- Go to Resend → Webhooks
- Click on your endpoint
- Check "Recent Deliveries"
- Verify no 4xx/5xx errors

#### Check Supabase Storage
- Go to Supabase → Storage → residency-proofs-temp
- Verify bills being uploaded in correct structure: `proof/{uuid}/{date}/bill.pdf`
- Check old bills being deleted (should only be 1 bill per user)

---

### 7. Annual Maintenance Calendar 📅

**Add to your calendar - repeat yearly:**

#### January (License Plate Renewal Prices)
- [ ] Check Illinois SOS website: https://www.ilsos.gov/departments/vehicles/basicfees.html
- [ ] Update Stripe products if prices changed
- [ ] Update SQL function if needed:
  ```sql
  -- Update the calculate_plate_renewal_cost function with new prices
  ```

#### February (City Sticker Prices)
- [ ] Check Chicago city clerk website for new sticker prices
- [ ] Update Stripe products if prices changed
- [ ] Update vehicleTypeInfo in `pages/protection.tsx` if needed

#### March (Security Review)
- [ ] Run security audit query:
  ```sql
  SELECT
    COUNT(DISTINCT user_id) as total_users_accessed,
    COUNT(*) as total_accesses,
    AVG(access_count) as avg_accesses_per_user
  FROM (
    SELECT user_id, COUNT(*) as access_count
    FROM license_access_log
    WHERE accessed_at > NOW() - INTERVAL '1 year'
    GROUP BY user_id
  ) t;
  ```
- [ ] Review unusual access patterns
- [ ] Generate transparency report (if needed)

#### April (Compliance Check)
- [ ] Verify Supabase SOC 2 still active
- [ ] Review RLS policies still working
- [ ] Check privacy policy up to date
- [ ] Test unusual access detection still working

---

## Quick Reference: What Each System Does

### City Sticker Renewals
**User pays:** Subscription ($12/month) + sticker cost when due
**System handles:** Driver's license + utility bill (permit zones only)
**Remitter endpoints:**
- `/api/city-sticker/get-driver-license?userId={uuid}`
- `/api/city-sticker/get-residency-proof?userId={uuid}` (permit zones only)
**Documents stored:**
- License: Until expiry (if multi-year) or 48h after access (if opted out)
- Utility bill: 31 days max

### License Plate Renewals
**User pays:** Included in subscription
**System handles:** License plate number, type, renewal cost calculation
**Remitter endpoints:**
- `/api/license-plate/get-renewal-info?userId={uuid}`
**Documents stored:** None (just metadata)

### Email Forwarding (Utility Bills)
**User forwards:** Monthly bills from ComEd, Peoples Gas, Xfinity
**Goes to:** `documents+{uuid}@autopilotamerica.com`
**Routed through:** Resend Inbound
**Webhook:** `/api/email/process-residency-proof-resend`
**Stored:** Supabase `residency-proofs-temp/proof/{uuid}/{date}/bill.pdf`
**Deleted:** After 31 days OR when new bill arrives

### Audit Logging
**Tracks:** Every license access
**Stored in:** `license_access_log` table
**Users see:** Access history in settings page
**Alerts on:** >3 accesses in 24h or >5 in 7 days

---

## Troubleshooting

### "Email forwarding not working"
1. Check Resend webhook logs for errors
2. Verify email routing domain configured correctly
3. Test webhook endpoint directly:
   ```bash
   curl -X POST https://ticketlesschicago.com/api/email/process-residency-proof-resend \
     -H "Content-Type: application/json" \
     -d '{"type": "email.received", "data": {...}}'
   ```

### "License plate cost not calculating"
1. Check if trigger is installed:
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'calculate_plate_cost';
   ```
2. Manually trigger calculation:
   ```sql
   UPDATE user_profiles
   SET license_plate_type = license_plate_type
   WHERE license_plate_type IS NOT NULL;
   ```

### "Access history not showing"
1. Check if RLS function exists:
   ```sql
   SELECT * FROM pg_proc WHERE proname = 'get_license_access_history';
   ```
2. Verify user has accesses:
   ```sql
   SELECT * FROM license_access_log WHERE user_id = '{uuid}';
   ```
3. Check RLS policies:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'license_access_log';
   ```

---

## Done! 🎉

You now have:
- ✅ License plate renewals for all Illinois vehicle types
- ✅ Automatic utility bill forwarding via Resend
- ✅ Complete audit logging for license accesses
- ✅ Transparent access history shown to users
- ✅ Updated pricing ($12/month or $120/year)
- ✅ Enhanced security and privacy messaging

**Next steps:**
1. Run the SQL migrations
2. Set up Resend webhook
3. Deploy code
4. Test everything
5. Monitor for first week
6. Set annual maintenance calendar reminders
