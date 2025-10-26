# Option B Setup - Action Items for Randy

## ✅ Completed Automatically
- [x] Generated `CRON_SECRET` and added to `.env.local`
- [x] Pushed code to production (Vercel is building now)
- [x] Created all necessary files and endpoints

## 🔧 Manual Steps Required

### 1. Run Database Migrations in Supabase

The migrations couldn't run automatically, so you need to execute them manually in the Supabase SQL Editor.

**Go to:** https://supabase.com/dashboard/project/YOUR_PROJECT/sql

**Run Migration 1: Create renewal_charges table**

Copy and paste this SQL:

```sql
-- Renewal Charges Table
CREATE TABLE IF NOT EXISTS public.renewal_charges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('city_sticker', 'license_plate', 'permit')),
  amount DECIMAL(10, 2) NOT NULL,
  stripe_fee DECIMAL(10, 2) DEFAULT 0,
  total_charged DECIMAL(10, 2) NOT NULL,
  vehicle_type TEXT,
  license_plate TEXT,
  renewal_deadline DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'charged', 'failed', 'refunded', 'remitted')) DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  remitted_at TIMESTAMP WITH TIME ZONE,
  remitter_confirmation_number TEXT,
  remitter_status TEXT CHECK (remitter_status IN ('pending', 'submitted', 'approved', 'rejected')),
  notification_sent BOOLEAN DEFAULT FALSE,
  notification_sent_at TIMESTAMP WITH TIME ZONE,
  charge_email_sent BOOLEAN DEFAULT FALSE,
  charge_email_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  charged_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_renewal_charges_user_id ON public.renewal_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_status ON public.renewal_charges(status);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_renewal_deadline ON public.renewal_charges(renewal_deadline);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_charge_type ON public.renewal_charges(charge_type);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_created_at ON public.renewal_charges(created_at);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_pending_deadline ON public.renewal_charges(status, renewal_deadline) WHERE status = 'pending';

ALTER TABLE public.renewal_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own renewal charges" ON public.renewal_charges
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage renewal charges" ON public.renewal_charges
  FOR ALL USING (true);

GRANT ALL ON public.renewal_charges TO authenticated;
GRANT ALL ON public.renewal_charges TO service_role;

COMMENT ON TABLE public.renewal_charges IS 'Tracks government renewal fees charged to users when deadlines approach (Option B remitter model)';
```

**Run Migration 2: Add renewal tracking fields**

```sql
-- Add fields to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS permit_expiry_date DATE;

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS has_vanity_plate BOOLEAN DEFAULT false;

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT 'PA' CHECK (vehicle_type IN ('PA', 'PB', 'SB', 'MT', 'LT'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_permit_expiry ON public.user_profiles(permit_expiry_date) WHERE permit_expiry_date IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.permit_expiry_date IS 'Residential parking permit expiration date';
COMMENT ON COLUMN public.user_profiles.has_vanity_plate IS 'Whether user has a vanity license plate (affects renewal cost)';
COMMENT ON COLUMN public.user_profiles.vehicle_type IS 'Vehicle type for city sticker: PA, PB, SB, MT, LT';
```

### 2. ✅ CRON_SECRET Already Set

**DONE!** You already have `CRON_SECRET` configured in Vercel, so no action needed.

### 3. Test the System (After Deployment Completes)

**Test the cron job manually:**

```bash
curl -X GET "https://autopilotamerica.com/api/cron/check-renewal-deadlines" \
  -H "Authorization: Bearer 4c172831a589e4306eb3edb56d5351e40afb6761f3d57b5e04c068920e3ed372"
```

Expected response:
```json
{
  "success": true,
  "cityStickerCharges": 0,
  "licensePlateCharges": 0,
  "permitCharges": 0,
  "errors": [],
  "timestamp": "2025-10-25T..."
}
```

**Check the admin dashboard:**

Visit: https://autopilotamerica.com/admin/remittances

(You'll need to be logged in as randy@autopilotamerica.com)

### 4. Set Up Test Data (Optional)

To test the system with real charges, you need a user with:
- `has_protection = true`
- `stripe_customer_id` set
- Expiry dates set 30 days in the future

**Example SQL to create test renewal:**

```sql
-- Set a test user's city sticker to expire in 30 days
UPDATE user_profiles
SET city_sticker_expiry = CURRENT_DATE + INTERVAL '30 days',
    vehicle_type = 'PA',
    has_protection = true
WHERE user_id = 'YOUR_USER_ID_HERE';
```

Then wait until tomorrow's cron run, or manually trigger the cron job with the curl command above.

## 📊 Monitoring

### Vercel Logs
Check cron job execution: https://vercel.com/randy-vollraths-projects/ticketless-chicago/logs

Look for:
- `🔄 Starting renewal deadline check...`
- `✅ Charged city sticker for user...`
- `❌ Errors...`

### Stripe Dashboard
Monitor charges: https://dashboard.stripe.com/payments

### Supabase
Query charges:
```sql
SELECT * FROM renewal_charges ORDER BY created_at DESC LIMIT 10;
```

## 🎯 What Happens Next

1. **Daily at 8am CT** - Cron job runs automatically via Vercel Cron
2. **Users charged** - For any renewals due in exactly 30 days
3. **Emails sent** - Confirmation or failure notifications
4. **You review** - Check `/admin/remittances` dashboard
5. **Submit to remitter** - File renewals with government service
6. **Mark as remitted** - Update status with confirmation number

## ✅ Checklist

- [x] Run Migration 1 in Supabase SQL Editor ✅ DONE
- [x] Run Migration 2 in Supabase SQL Editor ✅ DONE
- [x] CRON_SECRET already configured in Vercel ✅ DONE
- [ ] Wait for Vercel deployment to complete (~2 minutes)
- [ ] Test cron endpoint with curl command
- [ ] Visit admin dashboard and confirm it loads
- [ ] (Optional) Set up test user with expiry 30 days out
- [ ] (Optional) Manually trigger cron to test charge

## 🆘 Troubleshooting

**Cron returns 401 Unauthorized:**
- Check CRON_SECRET is set in Vercel
- Verify Authorization header matches secret

**Charge fails "User has no Stripe customer ID":**
- User hasn't completed Protection signup yet
- They need a valid payment method on file

**Email not sending:**
- Check RESEND_API_KEY is set in Vercel
- Verify email address is valid

**Table doesn't exist:**
- Run the migrations in Supabase SQL Editor
- Check for error messages in the SQL console

---

**Questions?** Check `OPTION_B_REMITTER_SERVICE.md` for full documentation.
