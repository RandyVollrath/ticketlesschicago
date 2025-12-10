# City Sticker Renewal Digital Intake System

## Overview
White-label digital intake system for city sticker renewals that eliminates walk-ins, automates data entry, and simplifies accounting for partners (remitters, dealerships, currency exchanges).

---

## 🎯 Key Features

### For Customers
- ✅ **Digital intake form** - Submit renewals online from home
- 📱 **Document upload** - Upload driver's license + proof of residence via phone/computer
- 💳 **Secure payment** - Stripe checkout with instant confirmation
- 📧 **Automated notifications** - Email/SMS confirmations and status updates
- 📦 **Flexible fulfillment** - Mail delivery or pickup options

### For Partners (Remitters/Dealers)
- 🏪 **Eliminates walk-ins** - All renewals handled digitally
- 💰 **Automatic payment forwarding** - Stripe Connect sends funds directly to partner account
- 📊 **Real-time dashboard** - View pending orders, completed renewals, revenue stats
- 🔗 **Portal integration** - Auto-push renewal data to partner's existing system via API
- 📝 **Audit logs** - Complete activity history for compliance
- 🔔 **Webhook notifications** - Get notified of new orders instantly

### For You (Platform Owner)
- 💵 **Commission revenue** - Automatic platform fee on each transaction
- 📈 **Scalable** - Onboard unlimited partners
- 🔐 **Secure** - Stripe Connect handles all payment compliance
- 🤖 **Automated** - Minimal manual intervention required

---

## 🏗️ System Architecture

```
Customer                    Platform (You)                Partner (Remitter)
   |                              |                              |
   |-- Submit renewal form ------>|                              |
   |   + Documents                |                              |
   |                              |                              |
   |<-- Order created ------------|                              |
   |    (confirmation email)      |                              |
   |                              |-- Webhook: New order ------->|
   |                              |                              |
   |-- Pay via Stripe ----------->|                              |
   |                              |                              |
   |                              |-- Transfer funds ----------->|
   |                              |   (minus platform fee)       |
   |                              |                              |
   |                              |-- Push to portal API ------->|
   |                              |    (renewal data)            |
   |                              |                              |
   |<-- Payment confirmed --------|<-- Renewal processed --------|
   |    (email + SMS)             |                              |
```

---

## 📊 Database Schema

### `renewal_partners`
Partners who process renewals (remitters, dealerships, etc.)

**Key fields:**
- `name`, `business_type`, `email`, `phone`
- `stripe_connected_account_id` - For automatic payment forwarding
- `api_key` - For dashboard access and portal integration
- `webhook_url` - Notify partner of new orders
- `commission_percentage` - Platform's cut (e.g., 10%)
- `service_fee_amount` - Fixed fee per transaction (e.g., $5)

### `renewal_orders`
Customer renewal applications

**Key fields:**
- `order_number` - Human-readable: RS-2025-123456
- `partner_id` - Which partner processes this
- Customer info: `name`, `email`, `phone`
- Vehicle info: `license_plate`, `vin`, `make`, `model`
- Address: `street_address`, `city`, `zip_code`
- `documents` (JSONB) - Uploaded files (license, proof of residence)
- `sticker_price`, `service_fee`, `total_amount`
- `payment_status` - pending, paid, failed, refunded
- `status` - submitted, documents_verified, payment_received, sent_to_city, completed
- `stripe_payment_intent_id`, `stripe_transfer_id`
- `pushed_to_portal` - Whether sent to partner's system

### `renewal_document_reviews`
Queue for manual document verification (if needed)

### `renewal_order_activity_log`
Audit trail of all actions for compliance

### `renewal_partner_stats`
Cached statistics for partner dashboards

---

## 🔌 API Endpoints

### Customer-Facing

#### `POST /api/renewal-intake/submit-order`
Submit renewal application with documents

**Request:**
```
Content-Type: multipart/form-data

Fields:
- partnerId (UUID)
- customerName, customerEmail, customerPhone
- licensePlate, licenseState, make, model, year
- streetAddress, city, state, zipCode
- stickerType (passenger|large|small|motorcycle)
- fulfillmentMethod (mail|pickup)

Files:
- drivers_license_front (image/pdf)
- drivers_license_back (image/pdf)
- proof_of_residence (image/pdf)
```

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "uuid",
    "orderNumber": "RS-2025-A1B2C3",
    "totalAmount": 105,
    "status": "submitted"
  },
  "nextStep": "payment",
  "paymentUrl": "/renewal-intake/payment?order=uuid"
}
```

#### `POST /api/renewal-intake/process-payment`
Process payment via Stripe Connect

**Request:**
```json
{
  "orderId": "uuid",
  "paymentMethodId": "pm_..."
}
```

**Response:**
```json
{
  "success": true,
  "paymentIntent": {
    "id": "pi_...",
    "status": "succeeded"
  },
  "order": {
    "id": "uuid",
    "orderNumber": "RS-2025-A1B2C3",
    "status": "payment_received"
  },
  "message": "Payment successful! Your renewal order is being processed."
}
```

**Payment Flow:**
1. Customer pays $105 total
2. Platform keeps $5 commission (configurable per partner)
3. Partner receives $100 automatically in their Stripe account
4. Order marked as paid
5. Data pushed to partner's portal via API (if configured)

---

### Partner Dashboard API

#### `GET /api/renewal-intake/partner-dashboard?view=overview`
Get dashboard overview

**Headers:**
```
X-API-Key: partner-api-key
```

**Response:**
```json
{
  "stats": {
    "today": { "orders": 12, "revenue": 1260 },
    "thisWeek": { "orders": 89, "revenue": 9345 },
    "thisMonth": { "orders": 342, "revenue": 35910 },
    "allTime": { "orders": 1523, "revenue": 159915 }
  },
  "statusBreakdown": {
    "submitted": 5,
    "payment_received": 8,
    "sent_to_city": 15,
    "completed": 314
  },
  "recentOrders": [...],
  "pendingReviews": 5
}
```

#### `GET /api/renewal-intake/partner-dashboard?view=orders&status=submitted`
Get filtered order list

**Query Parameters:**
- `view=orders`
- `status` (optional): submitted, payment_received, completed
- `startDate`, `endDate` (optional)
- `limit` (default: 50)

**Response:**
```json
{
  "orders": [
    {
      "id": "uuid",
      "orderNumber": "RS-2025-A1B2C3",
      "customer": {
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "+13125551234"
      },
      "vehicle": {
        "licensePlate": "ABC1234",
        "state": "IL",
        "make": "Toyota",
        "model": "Camry",
        "year": 2020
      },
      "amount": {
        "stickerPrice": 100,
        "serviceFee": 5,
        "total": 105
      },
      "status": "payment_received",
      "paidAt": "2025-01-15T10:30:00Z",
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 12
}
```

---

## 💰 Payment & Revenue Flow

### Stripe Connect Architecture

**Platform Account (You):**
- Main Stripe account
- Collects all payments
- Automatically transfers funds to partners
- Keeps platform fee

**Partner Connected Accounts:**
- Each partner has their own Stripe Connected Account
- Funds transferred automatically after payment
- Partner can see their revenue in Stripe dashboard
- Simplified 1099 reporting

### Example Transaction ($105 city sticker)

```
Customer pays: $105
  ├─ City sticker price: $100
  └─ Service fee: $5

Stripe processes payment → Platform receives $105

Automatic transfer to Partner:
  Platform keeps: $5 commission (configurable)
  Partner receives: $100 (in their Stripe account)

Partner can withdraw to bank account anytime
```

### Commission Models

**Option 1: Percentage-based**
```javascript
{
  "commission_percentage": 5,  // Platform keeps 5%
  "service_fee_amount": 0
}

// On $100 sticker:
// Customer pays: $100
// Partner receives: $95
// Platform keeps: $5
```

**Option 2: Fixed fee**
```javascript
{
  "commission_percentage": 0,
  "service_fee_amount": 5  // Fixed $5 per transaction
}

// Customer pays: $105
// Partner receives: $100
// Platform keeps: $5
```

**Option 3: Hybrid**
```javascript
{
  "commission_percentage": 3,  // 3% of sticker price
  "service_fee_amount": 2      // Plus $2 fixed
}

// On $100 sticker:
// Platform keeps: $3 + $2 = $5
// Partner receives: $100
// Customer pays: $105
```

---

## 🔗 Partner Portal Integration

### API Push (Automatic)

When a renewal is paid, the system can automatically push data to the partner's existing portal/system.

**Configuration:**
```javascript
{
  "partner_id": "uuid",
  "portal_integration_type": "api",
  "webhook_url": "https://partner-portal.com/api/renewals",
  "api_key": "partner-secret-key",
  "portal_credentials_encrypted": "encrypted-credentials"
}
```

**Webhook Payload:**
```json
{
  "action": "create_renewal",
  "order": {
    "orderNumber": "RS-2025-A1B2C3",
    "customer": {
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+13125551234",
      "address": {
        "street": "123 Main St",
        "city": "Chicago",
        "state": "IL",
        "zip": "60601"
      }
    },
    "vehicle": {
      "licensePlate": "ABC1234",
      "state": "IL",
      "vin": "1HGBH41JXMN109186",
      "make": "Toyota",
      "model": "Camry",
      "year": 2020
    },
    "stickerType": "passenger",
    "amount": 105,
    "documents": [
      {
        "type": "drivers_license_front",
        "url": "https://storage.../license-front.jpg"
      },
      {
        "type": "proof_of_residence",
        "url": "https://storage.../utility-bill.pdf"
      }
    ]
  }
}
```

**Partner Response:**
```json
{
  "success": true,
  "confirmationNumber": "CITY-789456"
}
```

---

## 📧 Automated Notifications

### Customer Notifications

**1. Order Confirmation** (Immediate)
```
Subject: City Sticker Renewal Received - RS-2025-A1B2C3

Hi John,

Your city sticker renewal application has been received!

Order Number: RS-2025-A1B2C3
Vehicle: ABC1234 (IL)
Amount: $105

Next Steps:
1. Complete payment: [Payment Link]
2. Your documents will be verified
3. Order will be submitted to the city

Questions? Reply to this email or call (312) 555-1234.
```

**2. Payment Confirmation** (After payment)
```
Subject: Payment Received - Your Sticker is Being Processed

Hi John,

Your payment of $105 has been received!

What's next:
✓ Documents verified
→ Processing with the city
→ Sticker will be mailed to: 123 Main St, Chicago, IL 60601

Expected delivery: 7-10 business days
```

**3. Sticker Ready** (When completed)
```
Subject: Your City Sticker is Ready!

Hi John,

Great news! Your city sticker has been processed.

Sticker #: 123456789
Expires: 06/30/2026

[Mail] Your sticker is on its way to:
123 Main St, Chicago, IL 60601

Tracking: [USPS Tracking Number]
```

### Partner Notifications

**Webhook: New Order**
```json
{
  "event": "renewal_order_created",
  "order": {...}
}
```

**Webhook: Payment Received**
```json
{
  "event": "payment_received",
  "order": {...},
  "transferAmount": 100,
  "platformFee": 5
}
```

---

## 🎨 Customer UI Flow

### Step 1: Information Form
```
┌─────────────────────────────────────┐
│ City Sticker Renewal Application    │
├─────────────────────────────────────┤
│ Progress: [1]━━━ 2 ━━━ 3           │
│                                      │
│ YOUR INFORMATION                     │
│ Name: [________________]             │
│ Email: [________________]            │
│ Phone: [________________]            │
│                                      │
│ VEHICLE INFORMATION                  │
│ License Plate: [______] State: [IL▼]│
│ Make: [_______] Model: [_______]    │
│                                      │
│ CHICAGO ADDRESS                      │
│ Street: [____________________]       │
│ City: [Chicago] ZIP: [_____]        │
│                                      │
│ STICKER TYPE                         │
│ ○ Passenger ($100)                   │
│ ○ Large Vehicle ($150)               │
│                                      │
│ [Next: Upload Documents]             │
└─────────────────────────────────────┘
```

### Step 2: Document Upload
```
┌─────────────────────────────────────┐
│ Upload Required Documents            │
├─────────────────────────────────────┤
│ Progress: 1 ━━━[2]━━━ 3             │
│                                      │
│ DRIVER'S LICENSE (FRONT)             │
│ [📁 Choose File]                     │
│ ✓ license-front.jpg uploaded         │
│                                      │
│ DRIVER'S LICENSE (BACK)              │
│ [📁 Choose File]                     │
│ ✓ license-back.jpg uploaded          │
│                                      │
│ PROOF OF RESIDENCE                   │
│ (Utility bill, lease, bank statement)│
│ [📁 Choose File]                     │
│ ✓ utility-bill.pdf uploaded          │
│                                      │
│ [Back] [Next: Review & Pay]          │
└─────────────────────────────────────┘
```

### Step 3: Review & Payment
```
┌─────────────────────────────────────┐
│ Review Your Application              │
├─────────────────────────────────────┤
│ Progress: 1 ━━━ 2 ━━━[3]            │
│                                      │
│ CUSTOMER                             │
│ John Doe                             │
│ john@example.com                     │
│                                      │
│ VEHICLE                              │
│ ABC1234 (IL) - Toyota Camry          │
│                                      │
│ ADDRESS                              │
│ 123 Main St, Chicago, IL 60601       │
│                                      │
│ ┌───────────────────────────────┐   │
│ │ PAYMENT SUMMARY               │   │
│ │                               │   │
│ │ City Sticker (Passenger) $100 │   │
│ │ Service Fee              $5   │   │
│ │ ─────────────────────────────│   │
│ │ TOTAL                    $105 │   │
│ └───────────────────────────────┘   │
│                                      │
│ [Back] [Submit & Pay $105]           │
└─────────────────────────────────────┘
```

---

## 🛠️ Implementation Guide

### 1. Database Setup
```bash
# Run migration
psql $DATABASE_URL -f database/migrations/create_renewal_intake_system.sql

# Create Supabase storage bucket
CREATE BUCKET renewal-documents (PUBLIC);
```

### 2. Stripe Setup

**Create Stripe Connect Platform:**
1. Go to Stripe Dashboard → Connect → Get Started
2. Choose "Platform or marketplace"
3. Set redirect URL: `https://yourdomain.com/partners/stripe-connect`
4. Get platform account ID

**Onboard Partner:**
```javascript
// Create connected account for partner
const account = await stripe.accounts.create({
  type: 'express',
  country: 'US',
  email: partner.email,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
});

// Save account ID
await supabase
  .from('renewal_partners')
  .update({ stripe_connected_account_id: account.id })
  .eq('id', partnerId);

// Generate onboarding link
const accountLink = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: 'https://yourdomain.com/partners/stripe-reauth',
  return_url: 'https://yourdomain.com/partners/dashboard',
  type: 'account_onboarding',
});

// Send link to partner
```

### 3. Partner Onboarding Flow

**Step 1: Partner signs up**
- Create account in `renewal_partners`
- Generate unique `api_key`
- Collect business info

**Step 2: Stripe Connect**
- Create Stripe Connected Account
- Partner completes onboarding
- Mark `payout_enabled = true`

**Step 3: Portal Integration (Optional)**
- Collect partner's API endpoint
- Set up webhook
- Test integration

**Step 4: Go Live**
- Generate embeddable form URL: `https://yourdomain.com/renewal-intake?partnerId=uuid`
- Partner adds link to their website
- Partner starts receiving orders

---

## 📊 Partner Dashboard Features

### Overview Page
- Today's orders & revenue
- This week/month/all-time stats
- Recent orders
- Pending document reviews

### Orders List
- Filterable by status, date range
- Search by plate/customer name
- Export to CSV

### Order Details
- Customer info
- Uploaded documents (view/download)
- Payment status
- Activity log (audit trail)
- Actions: Approve documents, mark completed, add notes

### Analytics
- Revenue trends
- Order volume over time
- Average order value
- Status funnel

---

## 🚀 Value Proposition

### For Partners
- **Eliminate walk-in traffic** - All renewals handled digitally
- **Save labor costs** - No manual data entry
- **Faster processing** - Orders come in pre-filled
- **Better customer experience** - Customers appreciate convenience
- **Built-in payment processing** - No need for cash/checks
- **Automatic accounting** - All transactions tracked in Stripe

### For Customers
- **Convenience** - Submit from home, no office visit
- **24/7 availability** - Submit anytime
- **Faster service** - No waiting in line
- **Digital receipts** - Instant confirmations
- **Track status** - Know when sticker is ready

### For You (Platform)
- **Recurring revenue** - Earn on every transaction
- **Scalable** - Add unlimited partners
- **Low maintenance** - Automated workflows
- **Network effects** - More partners = more volume

---

## 💡 Future Enhancements

### Phase 2
- [ ] SMS-based intake (text to submit)
- [ ] Mobile app for document scanning
- [ ] OCR for automatic form filling
- [ ] Batch processing for fleets

### Phase 3
- [ ] Multi-city support (LA, NYC, etc.)
- [ ] License plate lookup (pre-fill vehicle info)
- [ ] Recurring renewals (auto-charge yearly)
- [ ] Partner mobile app

---

## 📈 Pricing Examples

### Small Remitter (100 orders/month)
```
Revenue: 100 orders × $5 fee = $500/month
Annual: $6,000

Costs: Stripe fees (~2.9% + 30¢ × 100 = ~$320)
Net Profit: ~$5,680/year per partner
```

### Large Dealership (500 orders/month)
```
Revenue: 500 orders × $5 fee = $2,500/month
Annual: $30,000

Net Profit: ~$28,400/year per partner
```

### Platform with 50 Partners (avg 200 orders each)
```
Total Orders: 50 partners × 200 = 10,000 orders/month
Revenue: 10,000 × $5 = $50,000/month
Annual: $600,000

This is a SaaS goldmine! 💰
```

---

## ✅ Launch Checklist

- [ ] Database migration run
- [ ] Supabase storage bucket created
- [ ] Stripe Connect configured
- [ ] Test partner account created
- [ ] Test order submitted & paid
- [ ] Email notifications working
- [ ] Partner dashboard accessible
- [ ] API integration tested
- [ ] Legal docs ready (T&Cs, Privacy Policy)
- [ ] First partner onboarded! 🎉
