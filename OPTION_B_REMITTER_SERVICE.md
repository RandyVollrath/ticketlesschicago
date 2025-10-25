# Option B: Remitter Service Payment Model

## Overview

Option B implements automated charging for government renewal fees when deadlines approach, using a remitter service to file on behalf of users.

**Benefits:**
- ✅ No money transmitter license required
- ✅ Simpler accounting (charge when needed, not upfront)
- ✅ Better cash flow management
- ✅ Reduced compliance burden
- ✅ Users only pay when renewal is due

## Architecture

### 1. Database Schema

**New Table: `renewal_charges`**
Tracks all government renewal fees charged to users.

```sql
- id: UUID (primary key)
- user_id: UUID (foreign key to auth.users)
- charge_type: 'city_sticker' | 'license_plate' | 'permit'
- amount: Government fee amount
- stripe_fee: Processing fee (2.9% + $0.30)
- total_charged: Total charged to user
- status: 'pending' | 'charged' | 'failed' | 'refunded' | 'remitted'
- renewal_deadline: Date the renewal is due
- stripe_payment_intent_id: Stripe payment ID
- remitter_confirmation_number: Confirmation from remitter service
- remitter_status: 'pending' | 'submitted' | 'approved' | 'rejected'
```

**Updated Table: `user_profiles`**
Added fields for renewal tracking:

```sql
- permit_expiry_date: DATE
- has_vanity_plate: BOOLEAN
- vehicle_type: TEXT ('PA', 'PB', 'SB', 'MT', 'LT')
```

### 2. API Endpoints

#### `/api/renewals/charge` (POST)
Charges user's card for a specific renewal.

**Request:**
```json
{
  "userId": "uuid",
  "chargeType": "city_sticker",
  "vehicleType": "PA",
  "licensePlate": "ABC1234",
  "renewalDeadline": "2025-12-31"
}
```

**Response:**
```json
{
  "success": true,
  "chargeId": "uuid",
  "amountCharged": 97.55,
  "paymentIntentId": "pi_xxx"
}
```

**Authorization:** Requires `Bearer ${CRON_SECRET}` header

#### `/api/cron/check-renewal-deadlines` (GET)
Daily cron job that checks for renewals due in 30 days and charges users.

**Schedule:** Daily at 8am CT (1pm UTC)
**Vercel Cron:** `0 13 * * *`

**Process:**
1. Query for users with renewals due in exactly 30 days
2. Check if charge already exists (avoid duplicates)
3. Call `/api/renewals/charge` for each renewal
4. Send confirmation emails

**Response:**
```json
{
  "success": true,
  "cityStickerCharges": 12,
  "licensePlateCharges": 8,
  "permitCharges": 3,
  "errors": [],
  "timestamp": "2025-10-25T13:00:00Z"
}
```

### 3. Email Notifications

#### Success Email
Sent after successful charge:
- Government fee amount
- Processing fee
- Total charged
- Renewal deadline
- License plate
- "We'll file this on your behalf" message

#### Failure Email
Sent when charge fails:
- Amount attempted
- "Update payment method" CTA
- Link to settings page
- Common failure reasons

### 4. Admin Dashboard

**URL:** `/admin/remittances`

**Features:**
- View all charges (filterable by status)
- See pending remittances
- Mark charges as "remitted" with confirmation number
- Export to CSV for accounting
- View stats (total charged, pending, failed, remitted)
- Search and filter capabilities

**Access:** Restricted to admin emails (`randy@autopilotamerica.com`)

## Deployment

### 1. Run Database Migrations

```bash
node database/run-option-b-migrations.js
```

Or manually run these SQL files in Supabase:
1. `database/create-renewal-charges-table.sql`
2. `database/add-renewal-tracking-fields.sql`

### 2. Set Environment Variables

Required in `.env.local` and Vercel:
```bash
CRON_SECRET=<random-secret-key>
STRIPE_SECRET_KEY=<stripe-secret>
RESEND_API_KEY=<resend-key>
NEXT_PUBLIC_SITE_URL=https://autopilotamerica.com
```

### 3. Deploy to Production

```bash
git add .
git commit -m "🚀 Option B: Remitter service payment model"
git push origin main
```

Vercel will automatically:
- Deploy new API endpoints
- Set up cron job for daily deadline checks
- Build admin dashboard

### 4. Test the System

**Manual Test:**
```bash
# Test charge endpoint
curl -X POST https://autopilotamerica.com/api/renewals/charge \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-id",
    "chargeType": "city_sticker",
    "vehicleType": "PA",
    "licensePlate": "TEST123",
    "renewalDeadline": "2025-12-31"
  }'

# Test cron job
curl https://autopilotamerica.com/api/cron/check-renewal-deadlines \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Check Logs:**
- Vercel Dashboard → Functions → Logs
- Look for "🔄 Starting renewal deadline check..."
- Verify charges are created in Supabase

## Pricing

### Government Fees
- **City Sticker:**
  - Passenger Auto (PA): $94.80
  - Large Passenger (PB): $189.60
  - Small Business (SB): $266.40
  - Medium Truck (MT): $398.40
  - Large Truck (LT): $530.40
- **License Plate:**
  - Standard: $155
  - Vanity: $164
- **Permit:** $30

### Processing Fees
- Stripe: 2.9% + $0.30 per transaction
- Example: $94.80 city sticker = $3.05 fee = **$97.85 total**

## Timeline

### 30 Days Before Deadline
- Cron job detects approaching deadline
- User's card is charged
- Confirmation email sent
- Charge record created with status `charged`

### Admin Action Required
- Admin logs into `/admin/remittances`
- Reviews charged renewals
- Submits to remitter service
- Marks as "remitted" with confirmation number

### After Remittance
- Remitter service files with government
- Admin updates status to `remitted`
- User receives confirmation (optional)

## Monitoring

### Daily Checks
- Review cron job logs in Vercel
- Check for failed charges
- Monitor Stripe dashboard for disputes

### Weekly Reviews
- Review pending remittances in admin dashboard
- Export CSV for accounting
- Reconcile Stripe transactions

### Monthly Reports
- Total revenue from processing fees
- Success rate of charges
- Common failure reasons
- Remittance completion rate

## Error Handling

### Failed Charges
- Status set to `failed`
- Error message logged
- User receives failure email
- Retry logic (up to 3 attempts)

### Missing Payment Method
- User skipped (not charged)
- Logged for follow-up
- Can manually charge later

### Duplicate Prevention
- Check for existing charge record before creating new one
- Use composite key: `user_id + charge_type + renewal_deadline`

## Future Enhancements

### Phase 2
- [ ] Automatic retry for failed charges (3 days later)
- [ ] SMS notifications for charges
- [ ] User dashboard showing upcoming charges
- [ ] Remitter service API integration (automatic submission)

### Phase 3
- [ ] Bulk remittance submission
- [ ] Automatic reconciliation with government records
- [ ] Refund handling for overpayments
- [ ] Cost optimization (group remittances by deadline)

## Support

### Common Issues

**Q: User's card declined**
A: User receives email with "Update Payment Method" link. Admin can manually retry after user updates card.

**Q: Charged twice for same renewal**
A: Duplicate prevention should prevent this. Check `renewal_charges` table for existing charge. Refund duplicate if it occurred.

**Q: Renewal deadline changed**
A: Admin can manually create charge with correct deadline, or user can contact support.

**Q: User wants refund**
A: Admin marks charge as `refunded` and processes Stripe refund manually.

### Contact

For questions about Option B implementation:
- Randy: randy@autopilotamerica.com
- Technical docs: This file
- Admin access: https://autopilotamerica.com/admin/remittances
