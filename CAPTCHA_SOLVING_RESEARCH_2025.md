# hCaptcha Solving Research 2025-2026
## Comprehensive Analysis for Chicago Parking Ticket Lookup Service

**Date:** February 6, 2026
**Context:** Research for fallback plan when Chicago payment portal patches the current backend API bypass (which doesn't validate captcha tokens)

---

## Executive Summary

The hCaptcha solving landscape is in significant flux as of 2025-2026. Major providers like 2Captcha have removed hCaptcha support due to legal/compliance pressure, while newer AI-driven services continue to fill the gap. **For a legitimate consumer product checking parking tickets on behalf of authorized users, the legal risk is moderate but manageable with proper user consent and terms of service.**

**Key Findings:**
- **Cost:** $0.80-$3.00 per 1,000 solves (hCaptcha)
- **Success Rate:** 90-99% depending on service and hCaptcha difficulty
- **Latency:** 5-15 seconds typical (acceptable for background checks)
- **Legal Risk:** Moderate — violates hCaptcha TOS but not clearly illegal for legitimate consumer use with authorization
- **Best Alternative:** Chicago Open Data Portal API (free, legal, no captcha) should be explored first

---

## 1. Commercial Captcha Solving Services

### 1.1 Top Services for hCaptcha (2025-2026)

| Service | Approach | hCaptcha Price (per 1K) | Success Rate | Avg Latency | Status |
|---------|----------|------------------------|--------------|-------------|--------|
| **CapSolver** | AI-only | $0.80-$3.00 | Up to 99% | ~5 seconds | Active |
| **2Captcha** | Human+AI hybrid | $2.99 | High (human-backed) | ~9 seconds | **Removed hCaptcha support in 2025** |
| **Anti-Captcha** | Human workers | $2.99 | ~99% | ~7 seconds | Active |
| **Bright Data** | AI+infrastructure | $1.05-$1.50 | Not specified | Not specified | Active |
| **NoCaptcha AI** | AI-powered | Variable | Up to 97% | Variable | Active |
| **CapMonster Cloud** | Self-hosted AI | Variable | High | Very fast | Active (self-hosted option) |

### 1.2 Detailed Service Analysis

#### CapSolver (Recommended for Production)
- **Technology:** 100% AI and machine learning
- **Strengths:**
  - Fastest solve times (~5 seconds)
  - Lowest cost ($0.80/1K for reCAPTCHA v2, similar for hCaptcha)
  - Up to 99% success rate
  - Good API documentation
  - Works with Puppeteer, Playwright, Selenium
- **Weaknesses:**
  - AI-only struggles with highly sophisticated/novel hCaptcha implementations
  - Reportedly faced legal pressure from hCaptcha (as of 2025)
- **Best for:** High-volume automation where speed matters

#### Anti-Captcha (Most Reliable)
- **Technology:** 24/7 global human worker network
- **Strengths:**
  - ~99% accuracy via human intelligence
  - Handles complex/adaptive CAPTCHAs that fool AI
  - Proven track record
- **Weaknesses:**
  - Slower than AI (7+ seconds)
  - Slightly higher cost
  - Dependent on human availability (though 24/7 coverage)
- **Best for:** Critical accuracy needs, complex CAPTCHAs

#### 2Captcha
- **Status:** **No longer supports hCaptcha as of 2025** — removed from documentation
- **Reason:** Legal/compliance pressure from hCaptcha
- **Note:** Was previously the most popular hybrid service

#### Bright Data CAPTCHA Solver
- **Technology:** AI + automated IP rotation + browser fingerprinting + proxy infrastructure
- **Pricing Tiers:**
  - Pay-as-you-go: $1.50/1K
  - Growth: $1.27/1K ($499/mo)
  - Business: $1.12/1K ($999/mo)
  - Enterprise: Custom
- **Strengths:**
  - Integrated with their Web Unlocker and Scraping Browser
  - Full fingerprinting and anti-detection stack
- **Weaknesses:**
  - More expensive
  - Requires buying into their ecosystem
- **Best for:** Large-scale scraping operations that need full anti-detection

### 1.3 Industry Trends (2025-2026)

**Major Shift:** Several established providers quietly stopped supporting hCaptcha in 2025:
- 2Captcha removed hCaptcha guides from documentation
- Speculation around CapSolver receiving formal complaints from hCaptcha
- Some services now explicitly decline hCaptcha support

**Why This Matters:**
- Legal pressure is increasing
- Services are risk-averse about CFAA/DMCA exposure
- Smaller/newer services may be more willing but less reliable long-term

**Performance Expectations (2026 standards):**
- Success rate < 90% = "basically useless for production"
- Latency > 30 seconds = "painful"
- Good services: 5-15 seconds, 95%+ success

---

## 2. Open-Source & AI-Based Approaches

### 2.1 AI/ML Techniques

**Current State:**
- Large Multimodal Models (LMMs) like GPT-4o and Gemini can solve basic image CAPTCHAs with 90-97% accuracy
- Image recognition + reinforcement learning models trained specifically for hCaptcha
- Bespoke trained models can identify hCaptcha images but struggle with context-dependent challenges

**Limitations:**
- hCaptcha uses "multiple difficulty tiers, each layered with its own set of parameters"
- AI works well for standard image challenges but fails on:
  - Adaptive challenges that change based on user behavior
  - Context-dependent questions ("select all images with [obscure object]")
  - Enterprise hCaptcha with advanced bot detection
- Modern hCaptcha (2025+) uses behavioral analysis and fingerprinting that simple AI can't bypass

**Open-Source Tools:**
- GitHub repos exist (e.g., `luminati-io/hcaptcha-solver`, `aydinnyunus/ai-captcha-bypass`)
- Most use Selenium/Puppeteer + vision models
- **Reality:** These work for demos/research but fail in production against live hCaptcha due to:
  - Browser fingerprinting detection
  - Behavioral analysis (mouse movements, timing)
  - IP reputation checks
  - Dynamic challenge difficulty scaling

### 2.2 Hybrid Approach (Commercial + AI)

Many commercial services now use **hybrid AI + human fallback**:
1. AI attempts solve first (fast, cheap)
2. If AI fails or confidence is low, route to human worker
3. Return result to API caller

This provides best balance of:
- Speed (AI handles 70-80% of easy cases in 3-5 seconds)
- Accuracy (humans handle hard cases with 99% success)
- Cost (only pay human rates for difficult CAPTCHAs)

---

## 3. Success Rates & Latency

### 3.1 Real-World Performance (2025-2026)

**Success Rates:**
- Basic image CAPTCHAs: 90-97% (AI), 99%+ (human)
- Standard hCaptcha: 90-95% (AI), 99% (human)
- Enterprise hCaptcha: 60-80% (AI), 95-99% (human)
- Adaptive systems with behavioral analysis: 40-70% (AI), 90-95% (human)

**Key Insight:** "Success rates measured in production environments rather than controlled testing scenarios revealed major differences between advertised features and real-world performance."

**Latency:**
- AI-only: 1-9 seconds (CapSolver: ~5 sec average)
- Human-only: 7-15 seconds (Anti-Captcha: ~7 sec average)
- Hybrid: 3-15 seconds depending on difficulty
- Unacceptable: > 30 seconds

**For Parking Ticket Lookup:**
- Use case: Background automation (users don't wait in real-time)
- Tolerance: 15-30 seconds is acceptable
- Volume: Potentially hundreds/thousands per day (for all users)
- **Recommendation:** AI-first with human fallback is ideal

### 3.2 Reliability Factors

What affects success rate:
1. **hCaptcha Difficulty Tier:** Easy vs. Enterprise vs. Adaptive
2. **IP Reputation:** Clean residential IPs solve more reliably
3. **Browser Fingerprint:** Realistic fingerprints bypass detection
4. **Timing/Behavior:** Human-like delays and mouse movements
5. **Request Volume:** High volume from single IP triggers harder challenges

**Chicago Payment Portal Specifics:**
- Currently uses hCaptcha on frontend Angular SPA
- Backend API doesn't validate captcha tokens (current exploit)
- Unknown difficulty tier (likely standard, not Enterprise)
- When patched, likely to add backend validation but may not increase difficulty
- **Estimated success rate with commercial solver:** 90-95%

---

## 4. Legal & Ethical Considerations

### 4.1 Terms of Service Violations

**Clear Violations:**
- hCaptcha Terms of Service explicitly prohibit automated solving
- Website (Chicago payment portal) TOS likely prohibits scraping/automation
- CAPTCHA bypass services themselves operate in legal gray area

**Legal Precedent:**
- Courts have ruled CAPTCHAs are "technological measures" under DMCA
- Ticketmaster v. Prestige Entertainment (2018): CAPTCHA bypass = DMCA violation
- FTC enforcement under BOTS Act: Ticket scalpers prosecuted for CAPTCHA bypass + multiple accounts

### 4.2 CFAA (Computer Fraud and Abuse Act) Risk

**What CFAA Prohibits:**
- "Unauthorized access" to computer systems
- Bypassing security measures can constitute unauthorized access
- TOS violations can be considered "unauthorized" (circuit-split on this)

**Application to Parking Ticket Lookup:**

**Arguments AGAINST CFAA liability:**
1. **User authorization:** Users explicitly authorize you to check tickets on their behalf
2. **Legitimate purpose:** Looking up public information users have right to access
3. **No harm:** Not damaging systems, not accessing private data
4. **Public interest:** Helping consumers contest unfair tickets
5. **Precedent:** HiQ Labs v. LinkedIn (9th Circuit 2019) — scraping publicly available data not "unauthorized access" even if violates TOS (though this is not settled law nationally)

**Arguments FOR CFAA liability:**
1. **TOS violation = unauthorized access** (some circuits)
2. **Bypassing technical measure** (hCaptcha) to gain access
3. **Not official API** — Chicago doesn't provide authorized programmatic access

**Risk Assessment:**
- **Criminal prosecution:** Very low (CFAA criminal prosecution requires intent to defraud/harm + > $5,000 damages)
- **Civil lawsuit by Chicago:** Low-moderate (would require Chicago to prove damages, public interest defense, bad optics)
- **Civil lawsuit by hCaptcha:** Low (they target high-volume abusers, not small startups)
- **Cease & desist:** Moderate (most likely response if discovered)

**Mitigation Strategies:**
1. **User consent:** Explicit authorization in TOS ("By using this service, you authorize us to check tickets on your behalf")
2. **Rate limiting:** Don't overwhelm systems (2-5 second delays between requests)
3. **User benefit:** Document that service helps consumers exercise legal rights
4. **Transparency:** Don't hide what you're doing — explain in Privacy Policy
5. **Data minimization:** Only query what's needed, don't scrape/store bulk data

### 4.3 DMCA Section 1201

**What it prohibits:**
- Circumventing technological measures that control access to copyrighted works

**Application:**
- Courts have ruled hCaptcha is a "technological measure"
- Chicago payment portal HTML/JS is copyrighted
- Bypassing hCaptcha to access portal content = potential DMCA violation

**Counter-arguments:**
- No copyright infringement — just accessing public records
- Fair use for interoperability
- Section 1201(f) reverse engineering exception
- First Amendment concerns (accessing government data)

**Risk:** Moderate, but lower than CFAA for legitimate consumer use

### 4.4 State Laws

**Illinois Computer Crime Prevention Law (720 ILCS 5/17-50):**
- Similar to CFAA
- Prohibits unauthorized access
- Same analysis as CFAA

### 4.5 FTC BOTS Act

**What it prohibits:**
- Using bots to bypass security measures to purchase event tickets
- Specifically targets ticket scalpers

**Application to parking tickets:**
- Not applicable — BOTS Act is about event ticket purchases
- Parking ticket lookup is not commerce/purchasing

### 4.6 Privacy Laws (GDPR, CCPA)

**Issue:**
- If users are in EU/California, need GDPR/CCPA compliance
- Automated data processing requires transparency + user consent

**Mitigation:**
- Privacy Policy disclosing automation
- User consent for data processing
- Right to delete data

### 4.7 Overall Legal Risk Assessment

**For legitimate consumer product helping users check their own tickets:**

| Legal Risk | Severity | Likelihood | Mitigation |
|------------|----------|------------|------------|
| CFAA criminal | Very Low | Very Low | User authorization + legitimate purpose |
| CFAA civil (Chicago) | Low-Moderate | Low | User consent, rate limiting, public interest defense |
| DMCA | Low-Moderate | Low | Fair use, interoperability, no infringement |
| hCaptcha lawsuit | Very Low | Very Low | Small scale, user authorization |
| Cease & desist | Moderate | Moderate | Most likely outcome — would need fallback plan |
| FTC BOTS Act | None | None | Not applicable to parking tickets |
| Privacy (GDPR/CCPA) | Low | Moderate | Compliance via Privacy Policy + consent |

**Recommendation:**
- Legal risk is **manageable** for small-scale legitimate consumer use
- Ensure robust user consent and authorization mechanisms
- Have plan B ready (see Section 5)
- Consult lawyer for TOS/Privacy Policy review

**What NOT to do (high risk):**
- Bulk scraping for resale
- Creating fake accounts/identities
- Using service to harm/defraud others
- High-volume abuse that degrades Chicago systems
- Hiding/obfuscating what you're doing

---

## 5. Alternatives to CAPTCHA Solving

### 5.1 Chicago Open Data Portal API (BEST OPTION)

**What it is:**
- City of Chicago publishes datasets on data.cityofchicago.org
- Uses Socrata Open Data API (SODA)
- Programmatic access to public data
- **Free, legal, no CAPTCHA, no TOS violation**

**Parking Ticket Data Available:**
- Historical parking ticket datasets exist
- FOIA requests have yielded 36+ million tickets (2003-2016)
- Data Portal API allows queries via standard API

**How to Access:**
- Socrata Developer Site: dev.socrata.com
- API Console: data.cityofchicago.org/developers
- Supports REST queries, filtering, pagination

**Example Datasets:**
- Parking Tickets: Already published in various forms
- Red Light Camera Violations
- Speed Camera Violations

**What's Available:**
- Full ticket history (historical)
- Unknown if live/current tickets are in API (needs investigation)

**Action Items:**
1. **Investigate** what parking ticket data is in Chicago Data Portal
2. **Test queries** for current/open tickets vs. historical only
3. **Check update frequency** — is it real-time or batch updated?
4. **Confirm no authentication** required (Socrata often open)

**If Current Tickets ARE Available:**
- This is the **golden solution** — legal, free, fast, no CAPTCHA
- Would completely replace need for portal scraping
- Zero legal risk

**If Only Historical Data:**
- Could use for analytics but not live monitoring
- Would still need portal scraping for current status

### 5.2 FOIA Requests (Not Practical for Real-Time)

**What it is:**
- Freedom of Information Act requests to City of Chicago
- Request specific ticket data

**Process:**
- Must submit in writing
- Each department handles own FOIA
- Can request Excel, CSV, SQL formats

**Precedent:**
- Matt Chapman got 36M tickets via FOIA (PostgreSQL dump)
- Melissa Sanchez got duplicate ticket data via FOIA
- ProPublica published guide on Illinois FOIA

**CANVAS System:**
- Chicago's ticket database system (managed by IBM)
- Contract: 2012-2022, $190M+
- Someone sued for table schema (network security exemption)

**Why Not Practical for Product:**
- Weeks/months to process request
- Not real-time
- Can't automate FOIA for each user's ticket
- Useful for bulk research/data analysis, not live lookups

**Could Be Useful For:**
- One-time bulk data pull for analytics
- Understanding ticket patterns
- ML training data

### 5.3 Official API (Doesn't Exist)

**Searched for:**
- City of Chicago parking ticket API
- Payment portal API documentation
- Developer access to CANVAS

**Finding:**
- **No official API for live ticket lookup**
- Only public access is via web portal with hCaptcha
- Data Portal has historical data only (needs verification)

**Could Petition For:**
- Public interest argument for API access
- FOIA for API documentation (if it exists)
- Contact Chicago Department of Finance for developer access

**Likelihood:** Low, governments rarely provide APIs without advocacy/pressure

### 5.4 Maintaining Browser Sessions/Cookies

**Approach:**
- Solve hCaptcha once, maintain session
- Reuse cookies for subsequent requests
- Avoid need to solve CAPTCHA for every lookup

**Feasibility:**
- Works if Chicago backend doesn't validate captcha token per request
- Current bypass already exploits this (no validation)
- If they patch by requiring captcha token per search, this won't work

**Technical Approach:**
1. User solves hCaptcha once in real browser
2. Extract session cookies
3. Reuse cookies for automated backend API calls
4. Refresh session periodically when expires

**Pros:**
- Much cheaper (one human solve per session instead of per ticket)
- Faster (no solve latency except initial)
- Lower legal risk (less automation)

**Cons:**
- Session expiration (need to re-solve)
- Doesn't work if backend requires per-request captcha validation
- Cookie security/privacy concerns

### 5.5 User Solves CAPTCHA Themselves

**Approach:**
- Show hCaptcha to user in mobile app WebView
- User solves it
- App submits form with token

**Pros:**
- Zero legal risk
- No cost
- Always works

**Cons:**
- Poor UX (user has to click images)
- Can't do background automation
- Defeats purpose of "autopilot"

**When to Use:**
- Fallback if automated solving fails
- Initial manual check, then automated monitoring
- Compliance/legal concerns too high

### 5.6 Partnership with Chicago

**Long-shot approach:**
- Formal partnership with City of Chicago
- Official API access as registered partner
- Public interest mission (help citizens contest tickets)

**Precedent:**
- Some cities provide parking apps with API access
- Civic tech partnerships exist

**Process:**
1. Reach out to Department of Finance
2. Explain public benefit
3. Request official API or data feed
4. Negotiate terms/rate limits

**Likelihood:** Low, but worth exploring if product scales

---

## 6. Recommendations for Ticketless Chicago

### 6.1 Immediate Actions (Priority Order)

**1. Investigate Chicago Open Data Portal API (HIGHEST PRIORITY)**
- **Effort:** 4-8 hours research + testing
- **Potential Payoff:** Complete legal solution, zero cost
- **Action:**
  - Search data.cityofchicago.org for parking ticket datasets
  - Test Socrata API queries for current/open tickets
  - Check update frequency
  - Verify no authentication required
  - **If current data available:** Migrate away from portal scraping entirely

**2. Document User Authorization (LEGAL PROTECTION)**
- **Effort:** 2-4 hours
- **Potential Payoff:** CFAA/DMCA defense
- **Action:**
  - Update Terms of Service with explicit authorization language
  - Add Privacy Policy section on automated checking
  - User consent flow: "By using Autopilot, you authorize us to check tickets on your behalf"
  - Log consent (timestamp, user_id) in database

**3. Prepare CAPTCHA Solving Fallback (BACKUP PLAN)**
- **Effort:** 8-16 hours integration + testing
- **Potential Payoff:** Service continues when Chicago patches bypass
- **Action:**
  - Sign up for CapSolver (AI, fast, cheap) as primary
  - Sign up for Anti-Captcha (human, reliable) as fallback
  - Integrate APIs into chicago-portal-scraper.ts
  - Add retry logic: CapSolver → Anti-Captcha → fail gracefully
  - Set cost alerts (monitor spending)
  - Test on live Chicago portal

**4. Rate Limiting & Ethical Use (RISK MITIGATION)**
- **Effort:** 2-4 hours
- **Potential Payoff:** Reduces legal/technical risk
- **Action:**
  - Add 3-5 second delays between ticket lookups
  - Randomize delay slightly (2-6 seconds) to appear human
  - Implement daily quota per user (prevent abuse)
  - Monitor for Chicago blocking (IP bans, rate limits)
  - Use residential proxies if needed (Bright Data, etc.)

### 6.2 Cost Analysis

**Current (Bypass Works):**
- Cost: $0
- Latency: ~14 seconds per lookup
- Legal risk: Moderate

**CAPTCHA Solving (When Bypass Patched):**
- Cost: $0.80-$3.00 per 1,000 solves
- Example: 10,000 lookups/day = $8-$30/day = $240-$900/month
- Latency: ~14 seconds + 5-15 seconds for captcha = ~20-30 seconds total
- Legal risk: Moderate (same as current)

**Chicago Data Portal API (If Available):**
- Cost: $0
- Latency: < 1 second
- Legal risk: Zero (official API)

**Cost Optimization Strategies:**
- Use AI solver first (cheaper), fall back to human only if needed
- Batch queries when possible
- Cache results (don't re-check tickets for X hours)
- Only check on user request or schedule (not continuous polling)

### 6.3 Recommended Service Setup

**Primary:** CapSolver
- API: capsolver.com
- Pricing: $0.80-$2.00 per 1K
- Speed: ~5 seconds
- Integration: REST API, well-documented
- Use for: All initial solve attempts

**Fallback:** Anti-Captcha
- API: anti-captcha.com
- Pricing: ~$2.99 per 1K
- Speed: ~7 seconds
- Integration: REST API
- Use for: When CapSolver fails (< 10% of attempts)

**Workflow:**
```
User: Check my parking
  → Scraper: Try bypass first (free)
  → If blocked: Try CapSolver (cheap, fast)
  → If CapSolver fails: Try Anti-Captcha (reliable)
  → If both fail: Notify user "Portal temporarily unavailable"
  → Log failure for investigation
```

### 6.4 Timeline & Milestones

**Week 1:**
- [ ] Investigate Chicago Data Portal API
- [ ] Update TOS/Privacy Policy with authorization language
- [ ] Sign up for CapSolver + Anti-Captcha accounts

**Week 2:**
- [ ] Integrate CapSolver into portal scraper
- [ ] Add fallback logic to Anti-Captcha
- [ ] Test on live portal
- [ ] Add rate limiting (3-5 sec delays)

**Week 3:**
- [ ] Monitor costs + success rates
- [ ] Set up alerting for failures/blocks
- [ ] Document runbook for common issues
- [ ] User communication plan if captcha adds latency

**Week 4:**
- [ ] Evaluate Chicago Data Portal as replacement
- [ ] If Data Portal works: migrate users
- [ ] If not: continue with captcha solving + monitor legal landscape

### 6.5 Long-Term Strategy

**Ideal Path (Best Case):**
1. Chicago Data Portal has current ticket data → migrate to API → no CAPTCHA
2. Service is free, fast, legal forever

**Realistic Path (Base Case):**
1. Data Portal has historical only or no ticket data
2. Use current bypass until patched
3. When patched: CapSolver/Anti-Captcha fallback
4. Monitor costs, optimize caching/batching
5. Periodic review of legal landscape
6. If legal risk increases: pivot to user-solve-CAPTCHA or partner with Chicago

**Worst Case:**
1. Chicago aggressively blocks automated access (IP bans, advanced hCaptcha)
2. CAPTCHA solving costs become prohibitive (> $5/1K)
3. Legal threat (cease & desist)
4. **Response:** User-solve-CAPTCHA mode, reduce automation scope, seek official partnership

### 6.6 Monitoring & Metrics

**Track Weekly:**
- CAPTCHA solve attempts
- Success rate (CapSolver vs Anti-Captcha)
- Cost ($ per 1K, total spend)
- Latency (P50, P95, P99)
- Failure reasons (IP block, timeout, incorrect solve)
- User complaints about speed

**Set Alerts:**
- Success rate < 85% → investigate
- Cost > $50/day → review usage patterns
- Latency > 45 seconds → optimize or fallback
- IP blocked → rotate proxy

---

## 7. Technical Implementation Notes

### 7.1 CapSolver Integration Example

```typescript
// lib/captcha-solver.ts
import axios from 'axios';

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY;

interface CaptchaSolveRequest {
  websiteURL: string;
  websiteKey: string; // hCaptcha site key from portal
  type: 'HCaptchaTaskProxyLess';
}

async function solveHCaptcha(websiteURL: string, siteKey: string): Promise<string> {
  // Create task
  const createResponse = await axios.post('https://api.capsolver.com/createTask', {
    clientKey: CAPSOLVER_API_KEY,
    task: {
      type: 'HCaptchaTaskProxyLess',
      websiteURL,
      websiteKey: siteKey,
    },
  });

  const taskId = createResponse.data.taskId;

  // Poll for result
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // Poll every 3s

    const resultResponse = await axios.post('https://api.capsolver.com/getTaskResult', {
      clientKey: CAPSOLVER_API_KEY,
      taskId,
    });

    if (resultResponse.data.status === 'ready') {
      return resultResponse.data.solution.gRecaptchaResponse; // hCaptcha token
    }

    if (resultResponse.data.status === 'failed') {
      throw new Error(`CapSolver failed: ${resultResponse.data.errorDescription}`);
    }

    // Continue polling
  }
}
```

### 7.2 Fallback Logic

```typescript
// lib/chicago-portal-scraper.ts (enhanced)

async function getCaptchaToken(page: Page): Promise<string> {
  const websiteURL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';
  const siteKey = await page.evaluate(() => {
    // Extract hCaptcha site key from DOM
    const captchaDiv = document.querySelector('[data-hcaptcha-widget-id]');
    return captchaDiv?.getAttribute('data-sitekey') || 'SITE_KEY_HERE';
  });

  try {
    // Try CapSolver first (cheap, fast)
    console.log('Attempting CapSolver...');
    return await solveHCaptchaCapSolver(websiteURL, siteKey);
  } catch (err) {
    console.error('CapSolver failed:', err);

    try {
      // Fallback to Anti-Captcha (human, reliable)
      console.log('Falling back to Anti-Captcha...');
      return await solveHCaptchaAntiCaptcha(websiteURL, siteKey);
    } catch (err2) {
      console.error('Anti-Captcha failed:', err2);
      throw new Error('All CAPTCHA solvers failed');
    }
  }
}

async function lookupTickets(plate: string, state: string): Promise<TicketData[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Try bypass first (current method - free)
    await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1');

    // Fill form
    await page.fill('#licenseNumber', plate);
    await page.selectOption('#state', state);

    // Try bypass
    const bypassWorked = await tryBypassCaptcha(page);

    if (!bypassWorked) {
      // Bypass failed - get token from solver
      console.log('Bypass failed, using CAPTCHA solver...');
      const captchaToken = await getCaptchaToken(page);

      // Inject token into hCaptcha response field
      await page.evaluate((token) => {
        (window as any).hcaptcha.setResponse(token);
      }, captchaToken);
    }

    // Click search
    await page.click('#searchButton');

    // Intercept API response
    const response = await page.waitForResponse(
      res => res.url().includes('/payments-web/api/searches'),
      { timeout: 30000 }
    );

    const data = await response.json();
    return parseTickets(data);

  } finally {
    await browser.close();
  }
}
```

### 7.3 Rate Limiting

```typescript
// lib/rate-limiter.ts

class RateLimiter {
  private lastRequestTime: number = 0;
  private minDelay: number = 3000; // 3 seconds
  private maxDelay: number = 6000; // 6 seconds

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    // Random delay between min and max (appear human)
    const delay = Math.random() * (this.maxDelay - this.minDelay) + this.minDelay;

    if (elapsed < delay) {
      await new Promise(resolve => setTimeout(resolve, delay - elapsed));
    }

    this.lastRequestTime = Date.now();
  }
}

const rateLimiter = new RateLimiter();

// Use before each ticket lookup
await rateLimiter.throttle();
const tickets = await lookupTickets(plate, state);
```

---

## 8. Conclusion

### Key Takeaways

1. **Chicago Data Portal API should be investigated first** — could provide legal, free, fast solution
2. **CAPTCHA solving is feasible** but adds cost ($0.80-$3/1K) and latency (5-15 seconds)
3. **Legal risk is moderate but manageable** with proper user authorization and ethical use
4. **CapSolver + Anti-Captcha fallback** provides best balance of cost, speed, reliability
5. **Current bypass will eventually be patched** — need fallback plan ready

### Recommended Next Steps

1. **This week:** Investigate Chicago Data Portal API
2. **This week:** Update TOS/Privacy Policy with user authorization
3. **Next week:** Integrate CapSolver + Anti-Captcha fallback
4. **Ongoing:** Monitor costs, success rates, legal landscape

### Final Recommendation

**Start with Chicago Data Portal API investigation.** If current ticket data is available, this solves the problem completely with zero legal risk and cost. If not, proceed with CapSolver integration as primary solution with Anti-Captcha fallback. Document user authorization in TOS, implement rate limiting, and monitor the service closely for IP blocks or legal challenges.

The legal risk for a legitimate consumer product helping users check their own parking tickets is **moderate but acceptable** with proper mitigations. The key is ensuring explicit user authorization, avoiding bulk abuse, and being prepared to pivot if enforcement actions occur.

**Total estimated cost:** $8-$30/day or $240-$900/month for 10K daily lookups (but likely much less with caching and the current bypass continuing to work for most cases).

---

## 9. References & Resources

### Commercial Services
- CapSolver: https://www.capsolver.com
- Anti-Captcha: https://anti-captcha.com
- Bright Data: https://brightdata.com
- 2Captcha: https://2captcha.com (no longer supports hCaptcha)

### Chicago Data Access
- Chicago Data Portal: https://data.cityofchicago.org
- Socrata API Docs: https://dev.socrata.com
- Chicago FOIA: https://www.chicago.gov/city/en/depts/fin/dataset/foialog.html

### Legal Resources
- CFAA Text: 18 U.S.C. § 1030
- DMCA Section 1201: 17 U.S.C. § 1201
- Illinois Computer Crime Law: 720 ILCS 5/17-50
- Ticketmaster v. Prestige Entertainment (2018)
- HiQ Labs v. LinkedIn, 938 F.3d 985 (9th Cir. 2019)

### Technical Resources
- Playwright Documentation: https://playwright.dev
- hCaptcha Documentation: https://docs.hcaptcha.com
- Browser Fingerprinting: https://fingerprintjs.com

---

**End of Report**
