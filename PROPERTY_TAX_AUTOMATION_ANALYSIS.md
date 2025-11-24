# Property Tax Bill Automation - Feasibility Analysis

## Overview
Research into automating property tax bill downloads from Cook County Treasurer's website for proof of residency.

---

## Cook County Treasurer System

### Website: https://www.cookcountytreasurer.com

### Current Capabilities:
- ✅ Search by Property Index Number (PIN) or Address
- ✅ View tax bills online
- ✅ Download/print PDF copies of bills
- ✅ 20-year tax bill history available
- ✅ Electronic billing sign-up (email notifications)
- ✅ No login required for basic bill lookup

### Key Features:
1. **Public Access**: Bills are publicly viewable without login (just need PIN or address)
2. **PDF Available**: Bills can be downloaded as PDFs
3. **Always Available**: Year-round access (not just during tax season)
4. **Historical Data**: 20 years of tax bill history

---

## Automation Approaches

### Option 1: Web Scraping with Puppeteer (Recommended)

**How it works:**
1. User provides their address during onboarding
2. Backend Puppeteer script navigates to cookcountytreasurer.com
3. Enters address/PIN in search form
4. Navigates to tax bill page
5. Downloads PDF of most recent bill
6. Stores in Supabase Storage

**Pros:**
- ✅ No API needed (public website)
- ✅ No login required (bills are public)
- ✅ Legally permissible (user-authorized access to their own public records)
- ✅ Can run on schedule (quarterly checks for new bills)
- ✅ Low cost ($0 if using Vercel serverless functions)

**Cons:**
- ⚠️ Fragile - breaks if website structure changes
- ⚠️ Requires maintenance when Cook County updates their site
- ⚠️ Slower than API (10-30 seconds per bill)
- ⚠️ Need headless browser infrastructure

**Implementation Complexity**: Medium

**Cost**:
- Puppeteer runtime: $0 (included in Vercel)
- Browserless.io (if needed for better reliability): $20-50/month

---

### Option 2: Address → PIN Lookup + Direct Bill URL

**How it works:**
1. Convert address to PIN using Cook County Assessor API
2. Construct direct URL to tax bill PDF (if pattern is discoverable)
3. Download PDF directly without browser automation

**Pros:**
- ✅ Fast (1-2 seconds)
- ✅ More reliable than scraping
- ✅ Cheaper compute cost

**Cons:**
- ❌ May not work if bills require dynamic session/cookies
- ⚠️ Need to reverse-engineer URL pattern
- ⚠️ Still breaks if URL pattern changes

**Implementation Complexity**: Low-Medium

**Cost**: $0

---

### Option 3: Manual Upload (Current Implementation)

**How it works:**
1. User downloads their own tax bill from Cook County
2. User uploads PDF during Protection signup
3. Valid for 12 months

**Pros:**
- ✅ $0 cost
- ✅ 100% reliable
- ✅ No maintenance needed
- ✅ No legal/ToS concerns
- ✅ Already implemented

**Cons:**
- ❌ Not fully automated
- ❌ User friction
- ⚠️ Annual renewal required

**Implementation Complexity**: Already done!

**Cost**: $0

---

## Technical Implementation Plan

### If Pursuing Automation (Option 1):

#### Phase 1: Prototype (1 day)
```javascript
// Example Puppeteer script
const puppeteer = require('puppeteer');

async function fetchTaxBill(address) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to Cook County Treasurer
  await page.goto('https://www.cookcountytreasurer.com/');

  // Search by address
  await page.type('#address-input', address);
  await page.click('#search-button');
  await page.waitForNavigation();

  // Find and click "View Tax Bill" or "Download PDF"
  const pdfUrl = await page.evaluate(() => {
    const pdfLink = document.querySelector('a[href*=".pdf"]');
    return pdfLink ? pdfLink.href : null;
  });

  if (pdfUrl) {
    // Download PDF
    const pdfBuffer = await page.goto(pdfUrl).then(res => res.buffer());
    await browser.close();
    return pdfBuffer;
  }

  await browser.close();
  throw new Error('Tax bill not found');
}
```

#### Phase 2: API Endpoint (1 day)
```typescript
// /pages/api/property-tax/fetch-bill.ts
export default async function handler(req, res) {
  const { userId, address } = req.body;

  // Fetch tax bill using Puppeteer
  const pdfBuffer = await fetchTaxBill(address);

  // Upload to Supabase Storage
  const filePath = `residency-proofs/${userId}/property-tax.pdf`;
  await supabase.storage.from('residency-proofs-temps').upload(filePath, pdfBuffer);

  // Update user profile
  await supabase.from('user_profiles').update({
    residency_proof_path: filePath,
    residency_proof_type: 'property_tax',
    residency_proof_uploaded_at: new Date().toISOString()
  }).eq('user_id', userId);

  return res.json({ success: true });
}
```

#### Phase 3: Scheduled Updates (1 day)
- Cron job runs quarterly
- Checks for new tax bills
- Auto-updates stored bills
- Sends notification if bill needs user review

---

## Legal & Compliance Considerations

### Is Web Scraping Legal Here?

**YES**, for these reasons:

1. **Public Data**: Property tax bills are public records
2. **User-Authorized**: Users authorize us to access THEIR OWN data
3. **No Login Required**: No password sharing or account access needed
4. **No ToS Violation**: Accessing public government data for legitimate purpose
5. **Precedent**: Many real estate platforms do this (Zillow, Redfin, etc.)

### Best Practices:
- ✅ Rate limiting (max 1 request per second)
- ✅ User-Agent identification
- ✅ Respect robots.txt (if any)
- ✅ Cache results to minimize requests
- ✅ Clear user consent and disclosure

---

## Cost-Benefit Analysis

### Manual Upload (Current):
- **Cost**: $0
- **User Effort**: 5 minutes once/year
- **Reliability**: 100%
- **Maintenance**: None

### Automated Scraping:
- **Cost**: $0-50/month (depending on infrastructure)
- **User Effort**: 1 minute setup, then $0
- **Reliability**: 85-95% (breaks when site changes)
- **Maintenance**: 2-4 hours/year (when site breaks)

### ROI Calculation:
- **Users needing automation**: ~30% (homeowners who can't easily find docs)
- **Time saved per user**: 5 minutes/year
- **Development cost**: 3 days ($1,500 if valued at $500/day)
- **Annual maintenance**: 4 hours/year ($250/year)

**Break-even**: Would need ~600 users to justify initial development cost

---

## Recommendation

### Short-Term (Now): ✅ **Keep Manual Upload**
**Reasoning**:
- Already implemented and working
- $0 cost
- 100% reliable
- Covers 70-80% of users with lease/mortgage options

### Medium-Term (6 months): Consider automation if:
- ✅ Have 500+ permit users
- ✅ Getting frequent support requests about property tax bills
- ✅ User feedback indicates this is a major pain point
- ✅ Have dev bandwidth for maintenance

### Long-Term (1 year+): Full automation if:
- ✅ Have 1,000+ permit users
- ✅ Can justify $50/month for Browserless.io (more reliable than self-hosted)
- ✅ Want to offer premium "fully automated" tier

---

## Alternative: Hybrid Approach

### Best of Both Worlds:

1. **Default**: Manual upload (current)
2. **Optional Automation**: "Try automatic fetch" button
   - User clicks button
   - We attempt automated scraping
   - If fails → fallback to manual upload
   - If succeeds → user saved time!

**Benefits**:
- ✅ No user friction if automation fails
- ✅ Gradual rollout and testing
- ✅ Learn which addresses/cases work vs fail
- ✅ Improve automation over time

**Implementation**:
```typescript
// Button on Protection page
<button onClick={async () => {
  setLoading(true);
  try {
    const result = await fetch('/api/property-tax/auto-fetch', {
      method: 'POST',
      body: JSON.stringify({ address: streetAddress })
    });

    if (result.ok) {
      // Success! Bill fetched automatically
      setResidencyProofUrl(result.data.pdfUrl);
      setMessage('Property tax bill fetched automatically!');
    } else {
      // Failed - show manual upload
      setMessage('Auto-fetch failed. Please upload manually below.');
    }
  } catch (error) {
    setMessage('Auto-fetch unavailable. Please upload manually.');
  }
  setLoading(false);
}}>
  🤖 Try Automatic Fetch
</button>
```

---

## Next Steps

### To Implement Automation:

1. **Test Feasibility** (2 hours):
   - Write simple Puppeteer script
   - Test with 5-10 different Chicago addresses
   - Measure success rate and speed
   - Identify failure patterns

2. **If Feasible** (3 days):
   - Build API endpoint
   - Add "Try Auto-Fetch" button to Protection page
   - Test with real users (beta)
   - Monitor success/failure rates

3. **If Successful** (ongoing):
   - Make default option (with manual fallback)
   - Set up monitoring for breaks
   - Quarterly maintenance checks

### Or Skip Automation:

Keep manual upload, focus on:
- User education (where to find property tax bill)
- Better instructions/screenshots
- Support for users who struggle

---

## Conclusion

**Property tax automation is technically feasible but not urgent.**

**Current manual upload approach is:**
- ✅ Working well
- ✅ $0 cost
- ✅ Good enough for most users
- ✅ Can always add automation later

**Recommend**: Keep manual upload for now, revisit automation in 6-12 months if user feedback indicates strong need.

**If you want to prototype**: I can build a proof-of-concept Puppeteer scraper in a few hours to test feasibility with your personal address.
