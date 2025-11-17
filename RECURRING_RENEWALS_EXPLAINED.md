# Recurring Renewals: Year-Over-Year Tracking

## 🎯 The Question

**"How will this work next year? The user will have this field marked as 'paid' but it will need to be paid again."**

Great question! The answer is: **Each year gets its own record in `renewal_payments`.**

---

## 📊 Database Design (Current)

```sql
CREATE TABLE renewal_payments (
  id UUID PRIMARY KEY,
  user_id UUID,
  renewal_type TEXT, -- 'city_sticker' or 'license_plate'

  due_date DATE NOT NULL, -- ← THIS IS THE KEY!

  payment_status TEXT, -- 'pending', 'paid', 'failed', 'refunded'
  city_payment_status TEXT, -- 'pending', 'paid', 'failed'
  city_confirmation_number TEXT,

  created_at TIMESTAMP,
  paid_at TIMESTAMP
);
```

**Key Insight:** The `due_date` field ensures each renewal cycle gets its own record!

---

## 🔄 How It Works Year-Over-Year

### Year 1: 2025 Renewal

**User profile:**
```
city_sticker_expiry: 2025-12-15
```

**30 days before (Nov 15, 2025):**
1. Cron job creates NEW record:
   ```sql
   INSERT INTO renewal_payments (
     user_id = 'randy-uuid',
     renewal_type = 'city_sticker',
     due_date = '2025-12-15', -- ← Specific to THIS year
     payment_status = 'paid',
     city_payment_status = 'pending'
   )
   ```

2. Remitter processes and confirms:
   ```sql
   UPDATE renewal_payments
   SET city_payment_status = 'paid'
   WHERE due_date = '2025-12-15'  -- ← Matches this year's renewal
   ```

---

### Year 2: 2026 Renewal

**After 2025 renewal is complete:**
- Update user profile: `city_sticker_expiry = 2026-12-15` (new expiry date)

**30 days before (Nov 15, 2026):**
1. Cron job creates ANOTHER NEW record:
   ```sql
   INSERT INTO renewal_payments (
     user_id = 'randy-uuid',
     renewal_type = 'city_sticker',
     due_date = '2026-12-15', -- ← Different year!
     payment_status = 'paid',
     city_payment_status = 'pending'
   )
   ```

**Result:** Now you have TWO records:
```
┌────────────┬──────────────┬────────────┬─────────────────────┐
│ user_id    │ renewal_type │ due_date   │ city_payment_status │
├────────────┼──────────────┼────────────┼─────────────────────┤
│ randy-uuid │ city_sticker │ 2025-12-15 │ paid ✅             │
│ randy-uuid │ city_sticker │ 2026-12-15 │ pending ⏳          │
└────────────┴──────────────┴────────────┴─────────────────────┘
```

---

## 🔍 How Notification Query Works

**Current notification logic (from our fix):**

```typescript
const { data: payment } = await supabaseAdmin
  .from('renewal_payments')
  .select('city_payment_status, city_confirmation_number, paid_at')
  .eq('user_id', user.user_id)
  .eq('renewal_type', 'city_sticker')
  .gte('due_date', dueDate.toISOString().split('T')[0]) // ← Match THIS year's due date
  .lte('due_date', dueDate.toISOString().split('T')[0])
  .eq('city_payment_status', 'paid')
  .maybeSingle();
```

**Key:** The `.gte()` and `.lte()` clauses filter by `due_date`, so it only finds the CURRENT year's renewal!

**Example:**
- User has city_sticker_expiry = **2026-12-15**
- Query looks for due_date = **2026-12-15**
- Finds the 2026 record (not the 2025 one)

---

## 📅 Complete Timeline Example

### Randy's City Sticker Journey

**Year 1 (2025):**
```
Oct 2024: Randy signs up, city_sticker_expiry = 2024-12-15
Nov 15, 2024 (30 days before):
  - ✅ Charge card
  - ✅ Create renewal_payments record (due_date = 2024-12-15)
  - ⏳ city_payment_status = 'pending'

Nov 20, 2024:
  - ✅ Remitter submits to city
  - ✅ Updates city_payment_status = 'paid'

Dec 1, 2024 (14 days before):
  - ✅ Notification: "We already purchased your City Sticker"

Dec 15, 2024:
  - ✅ Sticker active
  - ✅ Update city_sticker_expiry = 2025-12-15 (next year)
```

**Year 2 (2025):**
```
Nov 15, 2025 (30 days before new expiry):
  - ✅ Charge card again
  - ✅ Create NEW renewal_payments record (due_date = 2025-12-15)
  - ⏳ city_payment_status = 'pending' (starts fresh!)

Nov 20, 2025:
  - ✅ Remitter submits to city
  - ✅ Updates THIS YEAR's record: city_payment_status = 'paid'

Dec 1, 2025:
  - ✅ Notification: "We already purchased your City Sticker"

Dec 15, 2025:
  - ✅ Sticker active
  - ✅ Update city_sticker_expiry = 2026-12-15 (next year)
```

**Database after 2 years:**
```sql
SELECT * FROM renewal_payments WHERE user_id = 'randy-uuid';

┌──────────────────┬──────────────┬────────────┬─────────────────────┬───────────────────────┐
│ id               │ renewal_type │ due_date   │ city_payment_status │ city_confirmation     │
├──────────────────┼──────────────┼────────────┼─────────────────────┼───────────────────────┤
│ uuid-2024-record │ city_sticker │ 2024-12-15 │ paid                │ CHI-2024-12345        │
│ uuid-2025-record │ city_sticker │ 2025-12-15 │ paid                │ CHI-2025-67890        │
└──────────────────┴──────────────┴────────────┴─────────────────────┴───────────────────────┘
```

**Each year = separate record with separate confirmation!**

---

## 🛠️ Cron Job Logic (Charging Users)

**When does new record get created?**

```typescript
// Runs daily
async function processProtectionRenewals() {
  // Find users whose city_sticker_expiry is exactly 30 days away
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { data: users } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('has_protection', true)
    .eq('city_sticker_expiry', thirtyDaysFromNow.toISOString().split('T')[0]);

  for (const user of users) {
    // Check if we already charged for THIS year's renewal
    const { data: existingPayment } = await supabase
      .from('renewal_payments')
      .select('id')
      .eq('user_id', user.user_id)
      .eq('renewal_type', 'city_sticker')
      .eq('due_date', user.city_sticker_expiry)
      .maybeSingle();

    if (existingPayment) {
      console.log('Already charged for this renewal period');
      continue;
    }

    // Charge the user
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 12500, // $125 for city sticker
      customer: user.stripe_customer_id,
      payment_method: user.default_payment_method,
      confirm: true
    });

    // Create NEW record for THIS year
    await supabase.from('renewal_payments').insert({
      user_id: user.user_id,
      renewal_type: 'city_sticker',
      due_date: user.city_sticker_expiry, // ← Links to THIS year
      payment_status: 'paid',
      city_payment_status: 'pending', // ← Starts as pending
      stripe_payment_intent_id: paymentIntent.id,
      paid_at: new Date()
    });
  }
}
```

**Key:** Each year when `city_sticker_expiry` is 30 days away, a NEW record is created!

---

## 🔌 Remitter API Endpoint

**Endpoint for remitter to confirm submission:**

```typescript
// POST /api/remitter/confirm-payment
export default async function handler(req, res) {
  const {
    user_id,
    renewal_type,
    due_date,
    city_confirmation_number
  } = req.body;

  // Authenticate remitter
  if (req.headers.authorization !== `Bearer ${process.env.REMITTER_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Update the specific renewal record
  const { data, error } = await supabaseAdmin
    .from('renewal_payments')
    .update({
      city_payment_status: 'paid',
      city_confirmation_number: city_confirmation_number
    })
    .eq('user_id', user_id)
    .eq('renewal_type', renewal_type)
    .eq('due_date', due_date) // ← Ensures we update the RIGHT year
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    success: true,
    message: 'City payment confirmed',
    renewal: data
  });
}
```

**Remitter calls it like:**
```bash
curl -X POST https://autopilotamerica.com/api/remitter/confirm-payment \
  -H "Authorization: Bearer remitter-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "randy-uuid",
    "renewal_type": "city_sticker",
    "due_date": "2026-12-15",
    "city_confirmation_number": "CHI-2026-12345"
  }'
```

**Result:** Only the 2026 record gets updated, 2025 record stays unchanged!

---

## 📊 Database Queries

### Get current year's pending renewals
```sql
SELECT * FROM renewal_payments
WHERE city_payment_status = 'pending'
  AND payment_status = 'paid' -- User paid us, we haven't paid city
  AND due_date >= CURRENT_DATE -- Only current/future renewals
ORDER BY due_date ASC;
```

### Get user's renewal history
```sql
SELECT * FROM renewal_payments
WHERE user_id = 'randy-uuid'
ORDER BY due_date DESC;
```

### Get specific year's renewal
```sql
SELECT * FROM renewal_payments
WHERE user_id = 'randy-uuid'
  AND renewal_type = 'city_sticker'
  AND due_date = '2026-12-15'; -- Specific year
```

---

## 🎯 Key Insights

1. **One record per renewal cycle** - Each year gets its own entry
2. **`due_date` is the discriminator** - Ensures we track the right year
3. **`city_payment_status` resets each year** - Starts 'pending', remitter marks 'paid'
4. **Historical records preserved** - Can track payments over time
5. **No conflict between years** - 2025 'paid' doesn't affect 2026 'pending'

---

## ✅ Best Practices

### When creating renewal record:
```typescript
// Always check if record exists for THIS due_date
const exists = await supabase
  .from('renewal_payments')
  .select('id')
  .eq('user_id', userId)
  .eq('renewal_type', renewalType)
  .eq('due_date', dueDate)
  .maybeSingle();

if (exists) {
  throw new Error('Renewal already charged for this period');
}
```

### When querying for confirmation:
```typescript
// Always filter by due_date to get the right year
const payment = await supabase
  .from('renewal_payments')
  .select('*')
  .eq('user_id', userId)
  .eq('renewal_type', renewalType)
  .eq('due_date', currentYearDueDate) // ← Critical!
  .single();
```

### When remitter confirms:
```typescript
// Always include due_date in update WHERE clause
UPDATE renewal_payments
SET city_payment_status = 'paid'
WHERE user_id = ?
  AND renewal_type = ?
  AND due_date = ? -- ← Ensures right year
```

---

## 🚀 Implementation Checklist

- [x] Database schema supports yearly records (has `due_date`)
- [x] Notification query filters by `due_date`
- [ ] Cron job checks for existing record before charging
- [ ] Remitter API endpoint requires `due_date` parameter
- [ ] Admin dashboard shows records by year
- [ ] User profile shows current + past renewals

---

## 💡 Summary

**The beauty of this design:**
- Each renewal cycle is independent
- No need to "reset" fields
- Full history preserved
- Easy to track which years are paid/pending
- Remitter can confirm renewals without affecting other years

**The `due_date` field is your friend!** It ensures each year's renewal is tracked separately, so you never have conflicts between 2025 being 'paid' and 2026 being 'pending'.
