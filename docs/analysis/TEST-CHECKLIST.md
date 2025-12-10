# MyStreetCleaning Sync Test Checklist

## 🧪 Test 1: New User Auto-Creation
**Goal:** Verify new TicketlessAmerica users automatically get MyStreetCleaning accounts

### Steps:
1. Create a new user in TicketlessAmerica (use a test email like `test123@example.com`)
2. During signup, set:
   - Home address
   - Ward and Section (use Ward 43, Section 1 for easy testing)
   - Phone number
   - Enable SMS notifications
3. Complete the signup/payment process
4. Check MyStreetCleaning database for the user
5. **Expected:** User should exist in MSC with matching ward/section

### Verify in Supabase:
```sql
-- In MyStreetCleaning database
SELECT email, home_address_ward, home_address_section, notify_sms 
FROM user_profiles 
WHERE email = 'test123@example.com';
```

---

## 🧪 Test 2: Profile Update Sync
**Goal:** Verify changes in TicketlessAmerica sync to MyStreetCleaning

### Steps:
1. Go to https://ticketlessamerica.com/settings
2. Change your address to a different ward/section
3. Toggle notification preferences (SMS on/off, evening before, etc.)
4. Click Save or let it auto-save
5. Check MyStreetCleaning database
6. **Expected:** MSC profile should update within seconds

### What to change and verify:
- [ ] Change Ward from 43 to 44 → MSC should update
- [ ] Change Section from 1 to 2 → MSC should update
- [ ] Toggle "Evening before" notification → MSC notify_evening_before should change
- [ ] Toggle "Follow-up SMS" → MSC follow_up_sms should change
- [ ] Change phone number → MSC phone_number should update

---

## 🧪 Test 3: Street Cleaning Notifications
**Goal:** Verify street cleaning notifications work with synced data

### Randy's Current Setup:
- TicketlessAmerica: Ward 43, Section 1
- MyStreetCleaning: Should now also be Ward 43, Section 1
- Street cleaning dates: Check MSC database

### Test Times (Chicago):
- **7 AM**: Morning reminder (if cleaning is today)
- **3 PM**: Follow-up (if cleaning was today)
- **7 PM**: Evening reminder (if cleaning is tomorrow)

### Manual Trigger:
```bash
# Trigger street cleaning notification check
curl -X POST https://ticketlessamerica.com/api/street-cleaning/process
```

---

## 🧪 Test 4: Renewal Notifications (Tomorrow!)
**Goal:** Verify timezone fix for renewal notifications

### Randy's Renewals:
- City Sticker: 2025-09-30 (tomorrow - should get 1-day reminder)
- License Plate: 2025-10-29 (30 days - should get 30-day reminder)
- Emissions: 2025-11-28 (60 days - should get 60-day reminder)

### Manual Trigger:
```bash
# Trigger renewal notification check
curl -X POST https://ticketlessamerica.com/api/notifications/process
```

### Check Logs:
Go to Vercel → Functions → Look for:
- `/api/notifications/process` logs
- Should show "Sending SMS to..." messages

---

## 🔍 Quick Verification Commands

### Check Randy's sync status:
```bash
node scripts/test-msc-sync.js --randy
```

### Test new user creation:
```bash
node scripts/test-msc-sync.js --new
```

### Force sync Randy:
```bash
node scripts/sync-all-users-to-msc.js --email randyvollrath@gmail.com
```

---

## ✅ Success Criteria

1. **New users** in TicketlessAmerica automatically appear in MyStreetCleaning
2. **Profile updates** in TicketlessAmerica sync to MyStreetCleaning within seconds
3. **Street cleaning notifications** use the synced ward/section
4. **Renewal notifications** calculate days correctly (timezone fix)

---

## 🐛 Debugging

If sync isn't working:
1. Check Vercel logs for `/api/profile` endpoint
2. Look for "Syncing to MyStreetCleaning" messages
3. Check for MSC database connection errors
4. Verify MSC_SUPABASE_URL and MSC_SUPABASE_SERVICE_ROLE_KEY are in Vercel env vars