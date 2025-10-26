# Test Email Management Guide

## Problem
Once an email is used to create an account, Supabase Auth "blocks" that email permanently - even if you delete the account from the database. This prevents you from reusing test emails.

## Solution
Use these scripts to manage your test emails.

---

## 📋 Check Which Emails Are Blocked

```bash
node list-test-emails.js
```

This will show:
- All test emails currently in use
- Which ones are blocked
- Next available Gmail alias number
- Suggestion to run cleanup if needed

**Example output:**
```
Gmail Aliases (randyvollrath+):
  ❌ randyvollrath+10@gmail.com (BLOCKED)

Example.com emails:
  ❌ test@example.com (BLOCKED)

📧 Next available Gmail alias:
   randyvollrath+11@gmail.com
```

---

## 🧹 Free Up Blocked Test Emails

```bash
node cleanup-test-emails.js
```

This will:
1. Find all test accounts (patterns: `randyvollrath+`, `@example.com`, `test@`)
2. Show you what will be deleted
3. Wait 3 seconds (Ctrl+C to cancel)
4. Delete all test accounts from auth system
5. Free up those emails for reuse

**Example output:**
```
🎯 Found 4 test accounts:
1. randyvollrath+10@gmail.com
2. test@example.com

⚠️  These accounts will be PERMANENTLY DELETED.
Press Ctrl+C to cancel, or wait 3 seconds...

✅ Deleted randyvollrath+10@gmail.com
✅ Deleted test@example.com

✨ Test emails are now available for reuse!
```

---

## 🎯 Recommended Test Email Patterns

### For Quick Testing
Use Gmail aliases (all go to your inbox):
```
randyvollrath+1@gmail.com
randyvollrath+2@gmail.com
randyvollrath+3@gmail.com
...
randyvollrath+99@gmail.com
```

**Note:** Since we added email normalization, these now all map to the same account (`randyvollrath@gmail.com`). If you need separate accounts, use the example.com domain instead.

### For Separate Test Accounts
Use @example.com (won't receive emails):
```
test@example.com
test1@example.com
test2@example.com
alice@example.com
bob@example.com
```

---

## 🔄 Typical Testing Workflow

1. **Create test account** with `randyvollrath+1@gmail.com`
2. **Test your feature**
3. **When done testing:**
   ```bash
   node cleanup-test-emails.js
   ```
4. **Reuse the same email** for next test

---

## ⚠️ Important Notes

### What Gets Deleted
- Auth user account (from Supabase Auth)
- User profile (cascades from auth deletion)
- Vehicles (cascades from auth deletion)
- Renewal charges (cascades from auth deletion)

### What Doesn't Get Deleted
Real user accounts! The scripts only target:
- `randyvollrath+*@gmail.com`
- `*@example.com`
- `test@*`
- `verifyenvfix@*`

### Safety
- 3-second countdown before deletion
- Shows exactly what will be deleted
- Ctrl+C to cancel anytime
- Only deletes test patterns

---

## 🚀 Quick Commands

```bash
# See what's blocked
node list-test-emails.js

# Clean everything
node cleanup-test-emails.js

# Clean and immediately list (verify it worked)
node cleanup-test-emails.js && node list-test-emails.js
```

---

## 📧 Currently Available Emails (After Cleanup)

All of these are now free to use:
- ✅ `randyvollrath+1` through `+99@gmail.com`
- ✅ `test@example.com`
- ✅ `test1@example.com`, `test2@example.com`, etc.
- ✅ Any `@example.com` email

---

## 🐛 Troubleshooting

**Q: Email still shows as "already in use"**
A: Wait 30 seconds and try again. Supabase Auth has a brief cache.

**Q: I want to delete a specific email, not all test emails**
A: Edit `cleanup-test-emails.js` and add your email pattern to `TEST_EMAIL_PATTERNS`.

**Q: Can I delete my main account (randyvollrath@gmail.com)?**
A: No, the scripts are designed to only delete test patterns. Your main account is safe.

**Q: Script says "0 test accounts found" but I just created one**
A: Check if the email matches the patterns. If not, manually add it to `TEST_EMAIL_PATTERNS`.

---

## 💡 Pro Tip

Add this to your `.bashrc` or `.zshrc` for quick access:
```bash
alias test-emails="node ~/path/to/ticketless-chicago/list-test-emails.js"
alias cleanup-emails="node ~/path/to/ticketless-chicago/cleanup-test-emails.js"
```

Then just run:
```bash
test-emails      # List blocked emails
cleanup-emails   # Clean them up
```
