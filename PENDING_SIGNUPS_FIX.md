# Fixed: Form Data Lost During OAuth Signup

## Problem
Safari (and other browsers) clear sessionStorage/localStorage during OAuth redirects, causing user signup data to be lost. This resulted in empty profiles being created.

## Solution
Store form data in a database table (`pending_signups`) before OAuth redirect, so it survives browser redirects.

---

## REQUIRED: Run This SQL First

**You MUST run this SQL in Supabase SQL Editor before the fix will work:**

```sql
-- Create pending_signups table to store form data before authentication
CREATE TABLE IF NOT EXISTS pending_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  license_plate TEXT,
  address TEXT,
  zip TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  city_sticker TEXT,
  token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Create index on email for fast lookups
CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(email);

-- Create index on expires_at for cleanup
CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at);

-- Enable RLS
ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything
CREATE POLICY "Service role has full access to pending_signups" ON pending_signups
  FOR ALL USING (true);

COMMENT ON TABLE pending_signups IS 'Temporary storage for signup form data before user authenticates';
```

---

## How It Works Now

### Old Flow (Broken in Safari):
1. User fills form
2. Data stored in sessionStorage/localStorage
3. Google OAuth redirect → **Safari clears storage**
4. Callback page: no data found
5. Settings page creates empty profile
6. Data lost forever ❌

### New Flow (Fixed):
1. User fills form
2. **Data saved to `pending_signups` table** (survives redirects)
3. Also stored in sessionStorage/localStorage (backup)
4. Google OAuth redirect
5. Callback page checks database → **finds data** ✅
6. Creates profile with data
7. Deletes from `pending_signups`
8. Success!

---

## Files Changed

### API Endpoints Created:
- `pages/api/pending-signup/save.ts` - Save form data before auth
- `pages/api/pending-signup/get.ts` - Retrieve saved data
- `pages/api/pending-signup/delete.ts` - Clean up after account creation

### Frontend Changes:
- `pages/alerts/signup.tsx` - Saves to database before OAuth
- `pages/auth/callback.tsx` - Checks database for pending signup

---

## Testing

After running the SQL:

1. **Test Google OAuth Signup:**
   ```
   Go to: https://ticketlessamerica.com/alerts/signup
   Fill out form
   Click "Sign Up with Google"
   → Should create account with all data
   ```

2. **Test Email Link Signup:**
   ```
   Go to: https://ticketlessamerica.com/alerts/signup
   Fill out form
   Click "Get Free Alerts (Email Link)"
   → Should create account immediately
   ```

3. **Check for Luigi's issue:**
   ```bash
   node check-user-data.js countluigivampa@gmail.com
   ```

---

## Cleanup Old Pending Signups

Add this to your cron jobs to clean up expired entries:

```sql
-- Delete pending signups older than 24 hours
DELETE FROM pending_signups WHERE expires_at < NOW();
```

---

## For Affected Users (Like Luigi)

Run this to fix their empty profiles:

```bash
node fix-empty-profile.js countluigivampa@gmail.com
```

It will prompt for their info and populate:
- `users` table
- `user_profiles` table
- `vehicles` table
