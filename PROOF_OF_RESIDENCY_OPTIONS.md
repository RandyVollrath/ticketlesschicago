# Proof of Residency Solutions - Research Summary

## Problem
Need to automatically obtain proof of residency (utility bills) for Chicago residential parking permit applications without manual user intervention.

## Key Findings

### ❌ UtilityAPI - DOES NOT WORK
- **Status**: ComEd and Peoples Gas are NOT supported
- **Error**: "ComEd is not a utility covered by UtilityAPI"
- **Coverage**: Only ~30 utilities, mostly in CA, NY, and select other states
- **Conclusion**: Cannot be used for Chicago residents

### 📧 Direct Utility Company Options

#### ComEd (Electric)
- **Paperless eBill**: Sends email **notifications** only, not PDF attachments
- **Process**: Email says "your bill is ready" → user must log into ComEd.com to view/download
- **PDF Option**: NO automated PDF delivery via email
- **Manual**: Users can download PDFs from their account (up to 6 months history)

#### Peoples Gas (Gas)
- **Paperless Billing**: Enrollment at tecoaccount.com
- **PDF Option**: Unclear from documentation if PDFs are attached to emails
- **Manual**: Users can likely download PDFs from their account portal

**Verdict**: Neither utility offers "PDF attached to email" option for automated forwarding

---

## Viable Solutions

### Option 1: **Arcadia Plug** (Recommended - Best for Automation)
**What it does**: OAuth-based utility data aggregator with 95% US coverage

**Pros**:
- ✅ **Supports 125+ utility providers** including ComEd (confirmed in docs)
- ✅ **Automated bill fetching** - user connects account once, you pull bills via API
- ✅ **PDF bills available** via standardized API
- ✅ **12-24 months historical data**
- ✅ **Ongoing monitoring** - pulls new bills automatically
- ✅ **Set-and-forget** - no user action needed after initial connection

**Cons**:
- ⚠️ **Pricing not public** (must contact sales)
- ⚠️ **Peoples Gas support unclear** (needs verification)

**Cost Estimate**: Unknown - likely enterprise pricing

**Integration Effort**: Medium (OAuth flow + API integration)

**Next Steps**: Contact Arcadia sales to confirm:
1. ComEd support (appears confirmed)
2. Peoples Gas support
3. Pricing structure
4. PDF availability

---

### Option 2: **Bayou Energy** (Recommended - Clear Pricing)
**What it does**: Bill parsing and data extraction service

**Pricing**:
- **$24/year per meter** (after first 10 free)
- **$2/month per user**
- **Most transparent pricing**

**Pros**:
- ✅ **Clear, predictable pricing**
- ✅ **First 10 users FREE**
- ✅ **Quick integration** (minutes according to docs)
- ✅ **12 months historical data**
- ✅ **Automatic fetching** after setup
- ✅ **Built for this use case**

**Cons**:
- ⚠️ **$24/year eats 80% of $30 permit fee profit**
- ⚠️ **ComEd/Peoples Gas support unclear** (needs verification)
- ⚠️ **May require bill uploads** vs automatic fetching

**Cost Impact**:
- Permit fee revenue: $30/year
- Bayou cost: $24/year
- Net profit: $6/year per user (20% margin)

**Integration Effort**: Low (email forwarding + API)

**Next Steps**:
1. Verify ComEd/Peoples Gas support
2. Confirm automatic fetching vs manual upload
3. Test with trial account

---

### Option 3: **Plaid Statements API** (Backup - Bank Statements)
**What it does**: Fetches bank statements as PDFs for address verification

**Pros**:
- ✅ **Universal** - works for anyone with a bank account
- ✅ **2 years of statements** available
- ✅ **Bank-branded PDFs** (official documents)
- ✅ **OAuth flow** (user connects once)
- ✅ **Established fintech infrastructure**

**Cons**:
- ❌ **Not a utility bill** - may not satisfy Chicago's requirements
- ❌ **Address can be changed** - less verifiable than utility bills
- ⚠️ **Pricing unclear** (must contact sales)
- ⚠️ **Per-statement billing** (could add up)

**Cost Estimate**: Unknown - "flexible per-Item fee model"

**Regulatory Risk**: HIGH - Chicago explicitly requires "utility bill" as proof of residency

**Integration Effort**: Medium (Plaid OAuth + API)

**Next Steps**:
1. Verify if Chicago accepts bank statements as proof of residency
2. Get pricing from Plaid sales
3. Compare cost to utility bill solutions

---

### Option 4: **Property Management APIs** (Lease Documents)
**What it does**: Fetch lease agreements from property management systems

**Examples**: AppFolio, Buildium, Yardi

**Pros**:
- ✅ **Definitive proof** of residency (lease agreement)
- ✅ **Covers renters** (majority of Chicago)
- ✅ **Long validity** (lease terms are 12+ months)

**Cons**:
- ❌ **Limited coverage** - only works if landlord uses these systems
- ❌ **Doesn't help homeowners** (need utility bills)
- ❌ **Multiple integrations** needed (3-4 major platforms)
- ❌ **Landlord permission** may be required
- ⚠️ **Complex integration** (each platform different)

**Cost**: Varies by platform (API access fees)

**Integration Effort**: High (multiple APIs)

**Verdict**: Too complex, limited coverage - not recommended as primary solution

---

### Option 5: **Email Forwarding (Current System)**
**What it does**: Users forward utility bill emails to your address

**Current Status**:
- ✅ **Already implemented** (Cloudflare Worker + API)
- ✅ **Works for PDF attachments**
- ❌ **Utilities don't send PDF attachments** (HTML notifications only)

**Could Work If**:
- User manually downloads PDF from utility portal and forwards it
- User sets up email forwarding AND downloads/attaches PDF monthly

**Verdict**: Not truly automated - requires monthly user action

---

### Option 6: **Manual Upload (Simplest)**
**What it does**: User uploads utility bill PDF during onboarding

**Pros**:
- ✅ **$0 cost**
- ✅ **Already implemented** (driver's license upload flow exists)
- ✅ **Works for 100% of utilities**
- ✅ **No third-party dependencies**

**Cons**:
- ❌ **Not "set and forget"** - breaks automation promise
- ❌ **Annual renewal required** - user must upload new bill each year
- ❌ **User friction** - additional step during signup
- ❌ **Compliance burden** - must remind users to update annually

**Integration Effort**: Minimal (reuse existing upload flow)

**Verdict**: Works but defeats "autopilot" value proposition

---

## Recommendation

### **Primary Recommendation: Bayou Energy + Arcadia Plug**

**Approach**:
1. **Sign up for both services** and test with your ComEd/Peoples Gas accounts
2. **Bayou first** (clearer pricing, easier to test)
3. **Arcadia backup** (better coverage, but unknown pricing)

**Why both?**
- Bayou has clear pricing ($24/year) but coverage uncertain
- Arcadia has confirmed coverage but pricing unknown
- Test both, choose based on cost vs coverage

**Timeline**:
- Week 1: Test Bayou with ComEd account
- Week 1: Contact Arcadia sales for pricing
- Week 2: Compare options and make final decision

### **Fallback: Hybrid Approach**

If APIs are too expensive:
1. **Email forwarding for users who can** (some utilities may offer PDF emails)
2. **Manual upload for everyone else** (one-time during onboarding)
3. **Annual reminder** to update bills (30 days before permit renewal)

**Cost**: $0 but sacrifices full automation

---

## Next Steps

### Immediate Actions:
1. ✅ Research ComEd/Peoples Gas PDF options - DONE (not available)
2. ⏳ **Test Bayou Energy** with personal ComEd account
3. ⏳ **Contact Arcadia sales** for ComEd/Peoples Gas support + pricing
4. ⏳ Research if Chicago accepts bank statements as proof of residency

### Decision Criteria:
- **Cost** < $10/user/year (33% of $30 permit fee)
- **Coverage** includes ComEd + Peoples Gas
- **Automation** = true set-and-forget (no monthly user action)
- **Reliability** = 95%+ success rate

### If APIs Don't Work:
- Pivot to manual upload with annual reminders
- Adjust pricing: increase permit fee to $40-45/year to cover costs
- Consider Chicago API integration for direct permit submission (skip residency proof)

---

## Cost-Benefit Analysis

| Solution | Cost/Year | Profit Margin | Automation | Coverage |
|----------|-----------|---------------|------------|----------|
| Bayou Energy | $24 | 20% ($6) | ✅ High | ❓ Unknown |
| Arcadia Plug | ❓ | ❓ | ✅ High | ✅ Confirmed |
| UtilityAPI | $1.50 | 95% ($28.50) | ✅ High | ❌ No Chicago |
| Plaid | ❓ | ❓ | ✅ High | ❌ Wrong doc type |
| Manual Upload | $0 | 100% ($30) | ❌ Low | ✅ 100% |

**Target**: Find solution with $5-10/year cost (67-83% margin)

---

## Questions for Vendors

### Bayou Energy:
- ✅ Do you support ComEd (Commonwealth Edison)?
- ✅ Do you support Peoples Gas Chicago?
- ✅ Is fetching automatic or do users need to upload/forward bills?
- ✅ Can I test with a free trial account?

### Arcadia Plug:
- ✅ Confirm ComEd support (appears in docs)
- ✅ Do you support Peoples Gas Chicago?
- ✅ What is your pricing structure?
- ✅ What's the cost per user/month or per API call?
- ✅ Are bill PDFs available or just structured data?

---

## Conclusion

**UtilityAPI was a dead end** - ComEd not supported.

**Best path forward**: Test Bayou Energy + get Arcadia pricing quote, then decide based on cost vs coverage.

**Worst case**: Manual upload with annual reminders (still better than nothing).

**Decision point**: Is 20% profit margin ($6/year per user) acceptable, or do we need a cheaper solution?
