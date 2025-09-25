# Rewardful Setup Instructions

## 🔧 SETUP REQUIRED

You need to add your Rewardful API Secret to make affiliate tracking work.

### 1. Get Your API Secret
1. Log into Rewardful Dashboard
2. Go to Company Settings
3. Copy your API Secret

### 2. Add to Environment Variables

**Local (.env.local):**
```
REWARDFUL_API_SECRET=YOUR_ACTUAL_SECRET_HERE
```

**Vercel Dashboard:**
1. Go to Settings → Environment Variables
2. Add `REWARDFUL_API_SECRET` with your actual secret
3. Deploy to apply changes

## ✅ What I Fixed

### JavaScript Integration (Frontend)
- ✅ Fixed referral ID capture using `Rewardful.referral` (capital R)
- ✅ Added client-side conversion tracking on success page
- ✅ Properly captures affiliate info from cookies

### REST API Integration (Backend) 
- ✅ Fixed API endpoint: `https://api.getrewardful.com/v1/conversions`
- ✅ Fixed authentication: Basic Auth with API Secret as username
- ✅ Webhook sends conversion data when payment succeeds

## 📊 How It Works

1. **Affiliate shares link**: `ticketlessamerica.com/?via=AFFILIATE_TOKEN`
2. **Visitor clicks**: Rewardful sets cookie with referral ID
3. **Form submission**: Captures referral ID from `Rewardful.referral`
4. **Stripe checkout**: Referral ID passed as `client_reference_id`
5. **Payment success**: Webhook reports conversion to Rewardful
6. **Backup tracking**: Success page also tracks client-side

## 🧪 Testing

Once you add your API Secret:

1. Visit with affiliate link: `https://ticketlessamerica.com/?via=TEST`
2. Open browser console and verify:
   - "Rewardful is ready!"
   - "Rewardful referral ID found: [UUID]"
3. Complete signup with test card: 4242 4242 4242 4242
4. Check Stripe webhook logs for conversion tracking
5. Check Rewardful dashboard for the conversion

## 🔍 Debugging

**Browser Console:**
- `window.Rewardful.referral` - Shows referral ID
- `window.Rewardful.affiliate` - Shows affiliate info
- `window.Rewardful._cookie` - Debug data

**Server Logs:**
- Check Vercel function logs for webhook processing
- Look for "Sending conversion to Rewardful"
- Check for API errors if conversion fails

## ⚠️ Common Issues

- **No conversions tracked**: Check API Secret is correct
- **No referral ID**: Ensure visitor came through affiliate link
- **Ad blockers**: May block Rewardful script
- **Cookies blocked**: Private/incognito mode may block cookies