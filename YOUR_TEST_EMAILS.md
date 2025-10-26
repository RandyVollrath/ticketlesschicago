# Your Test Emails - Quick Reference

## ✅ Available Gmail Accounts for Testing

All of these are **cleared and ready to use** with unlimited +aliases:

```
✅ hiautopilotamerica@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: hiautopilotamerica+1@gmail.com

✅ mystreetcleaning@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: mystreetcleaning+1@gmail.com

✅ hellodolldarlings@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: hellodolldarlings+1@gmail.com

✅ hellosexdollnow@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: hellosexdollnow+1@gmail.com

✅ principleddating@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: principleddating+1@gmail.com

✅ thechicagoapp@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: thechicagoapp+1@gmail.com

✅ countluigivampa@gmail.com
   - Can use: +1, +2, +3, +4, +5... (unlimited)
   - Example: countluigivampa+1@gmail.com
```

## 🚀 Quick Testing Workflow

### Option 1: Use +Aliases (Recommended)
Pick any base email above and add +1, +2, +3:

```
Test 1: hiautopilotamerica+1@gmail.com
Test 2: hiautopilotamerica+2@gmail.com
Test 3: hiautopilotamerica+3@gmail.com
...
Test 99: hiautopilotamerica+99@gmail.com
```

**Benefits:**
- Unlimited test emails
- All emails go to your inbox
- Can verify emails if needed

### Option 2: Use @example.com
For tests where you don't need to receive emails:

```
test@example.com
test1@example.com
alice@example.com
bob@example.com
```

## 🧹 When You Need to Clean Up

If an email gets "stuck" (shows as already in use), run:

```bash
# Clean all test patterns
node cleanup-test-emails.js

# Or clean specific emails
node cleanup-specific-emails.js
```

This frees up the emails for reuse.

## 🔍 Check If Email Is Available

```bash
# List all blocked test emails
node list-test-emails.js

# Check a specific email
node check-specific-email.js
```

## 💡 Pro Tips

1. **Stick with one base email** for most testing:
   - Example: Use `hiautopilotamerica+1`, `+2`, `+3` for everything
   - Easy to track and clean up

2. **Clean up after testing sessions:**
   ```bash
   node cleanup-test-emails.js
   ```

3. **You'll never run out of test emails** - just increment the number!

## ⚠️ Important

- Your main account (`randyvollrath@gmail.com`) is protected
- Cleanup scripts only delete test patterns
- All test emails are safe to delete (no customer data)

---

**TL;DR:** Use `hiautopilotamerica+1@gmail.com`, `+2`, `+3`, etc. for unlimited test accounts. Run `node cleanup-test-emails.js` when needed.
