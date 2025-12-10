# Test New Signup Flow

## Test with Fresh Email

Use: `countluigivampa+test1@gmail.com` (or any +tag)

### Steps:

1. **Clear any existing test data:**
   ```bash
   node check-user-data.js countluigivampa+test1@gmail.com
   # Should show: NOT found
   ```

2. **Go to signup page:**
   - https://ticketlessamerica.com/alerts/signup

3. **Fill out form completely:**
   - First Name: Luigi
   - Last Name: Test
   - Email: countluigivampa+test1@gmail.com
   - Phone: (224) 567-8901
   - License Plate: TEST123
   - Address: 1350 W Kenmore Ave
   - ZIP: 60614

4. **Click "Sign Up with Google"**

5. **After auth redirect, check data:**
   ```bash
   node check-user-data.js countluigivampa+test1@gmail.com
   ```

Expected results:
- ✅ Auth user exists
- ✅ Users table has data
- ✅ User_profiles has phone, plate, address
- ✅ Vehicles table has vehicle

---

## What Could Go Wrong

### Issue 1: Profile Already Exists (Your Current Problem)
**Cause:** User has empty profile from before deployment
**Fix:** Delete profile first or use fresh email

### Issue 2: Pending Signup Not Saved
**Cause:** API endpoint failed
**Check:**
```bash
node check-pending-signup.js EMAIL
```

### Issue 3: Callback Doesn't Check Database
**Cause:** Old code cached in browser
**Fix:** Hard refresh (Cmd+Shift+R) or incognito

### Issue 4: Settings Page Creates Empty Profile First
**Cause:** Callback didn't find pending signup, redirected to settings
**Check logs in browser console**

---

## For Reused Test Users

**Problem:** If user already has a profile, the flow is:
1. Fill form → saves to pending_signups
2. Auth → callback checks pending_signups
3. Calls /api/alerts/create with upsert
4. **SHOULD update existing profile** ✅

But if there's an error or the callback doesn't run, you get orphaned pending signup.

**To reuse a test user:**
```bash
# Apply any pending signup manually
node apply-pending-signup.js EMAIL

# OR delete everything and start fresh
# (need to create this script if you want)
```

---

## Debug Checklist

1. Is pending_signups table created?
   ```bash
   node run-pending-signups-sql.js
   # Should say "already exists"
   ```

2. Is deployment live?
   ```bash
   vercel ls | head -10
   # Check timestamp
   ```

3. Does form save to database?
   - Open browser console
   - Fill form, click Google button
   - Should see: "Saving signup data to database"
   - Check: `node check-pending-signup.js EMAIL`

4. Does callback check database?
   - After OAuth, check browser console
   - Should see: "Checking database for pending signup data"
   - Should see: "Found pending signup in database"

5. Does profile get created?
   - Check: `node check-user-data.js EMAIL`
