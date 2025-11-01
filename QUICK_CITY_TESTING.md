# Quick City Testing Guide (10 mins per city)

## Goal
Verify data works well enough to ship with "BETA" label. Not perfection - just "good enough."

---

## San Francisco Testing (10 minutes)

### Step 1: Find Official SF Tool (2 mins)
- Go to: https://streetsla.lacity.org/sweeping (or SF equivalent)
- Bookmark it

### Step 2: Test 5 Random Addresses (5 mins)
Pick 5 addresses from different neighborhoods:

1. **Downtown**: `123 Market St, San Francisco, CA`
   - [ ] Check official site
   - [ ] Check your site `/sf-street-sweeping`
   - [ ] Do they roughly match? (same street, same days)

2. **Richmond**: `456 Clement St, San Francisco, CA`
   - [ ] Check official site
   - [ ] Check your site
   - [ ] Match?

3. **Mission**: `789 Valencia St, San Francisco, CA`
   - [ ] Check official site
   - [ ] Check your site
   - [ ] Match?

4. **Sunset**: `321 Irving St, San Francisco, CA`
   - [ ] Check official site
   - [ ] Check your site
   - [ ] Match?

5. **SOMA**: `654 Howard St, San Francisco, CA`
   - [ ] Check official site
   - [ ] Check your site
   - [ ] Match?

### Step 3: Decision (3 mins)
- **4-5 matches**: ✅ Ship it with BETA label
- **2-3 matches**: ⚠️ Check a few more, fix obvious issues
- **0-1 matches**: ❌ Data is broken, don't ship

---

## Boston Testing (10 minutes)

### Step 1: Find Official Boston Tool
- Boston sweeping lookup: https://www.boston.gov/departments/public-works/street-sweeping

### Step 2: Test 5 Random Addresses
1. **Back Bay**: `123 Newbury St, Boston, MA`
2. **North End**: `456 Hanover St, Boston, MA`
3. **South Boston**: `789 East Broadway, Boston, MA`
4. **Jamaica Plain**: `321 Centre St, Boston, MA`
5. **Allston**: `654 Harvard Ave, Boston, MA`

### Step 3: Decision
Same as SF - need 4/5 to ship

---

## San Diego Testing (10 minutes)

### Step 1: Find Official SD Tool
- SD sweeping: https://www.sandiego.gov/stormwater/services/streetsweeping

### Step 2: Test 5 Random Addresses
1. **Downtown**: `123 Broadway, San Diego, CA`
2. **Pacific Beach**: `456 Garnet Ave, San Diego, CA`
3. **North Park**: `789 University Ave, San Diego, CA`
4. **La Jolla**: `321 Pearl St, San Diego, CA`
5. **Hillcrest**: `654 5th Ave, San Diego, CA`

### Step 3: Decision
Same as others - 4/5 matches = ship

---

## What "Match" Means

You DON'T need:
- ❌ Exact times to match
- ❌ Perfect street segment boundaries
- ❌ 100% accuracy

You DO need:
- ✅ Same street name found
- ✅ Same general day of week (if it says "Monday" and official says "1st Monday", that's fine)
- ✅ Roughly correct area

**Example of GOOD ENOUGH:**
- Official: "1st & 3rd Monday, 8am-11am, Mission St between 14th-16th"
- Your tool: "Mondays, 8am-12pm, Mission St"
- **PASS** ✅ Close enough for beta!

**Example of NOT GOOD:**
- Official: "Tuesdays, 9am-12pm"
- Your tool: "No street sweeping found"
- **FAIL** ❌ Data is broken

---

## After Testing

### If 4-5 cities pass:
1. Add `<BetaBanner city="San Francisco" />` to each page
2. Ship it
3. Wait for user feedback
4. Enable notifications after 1-2 weeks if no major errors

### If cities fail:
1. Check database - is data actually imported?
2. Check API - is geocoding working?
3. Debug or skip that city

---

## Total Time Investment
- **30 minutes** (10 mins × 3 cities)
- vs. **Days/weeks** of comprehensive testing

## Risk Mitigation
- Beta label sets expectations
- "Report error" link captures issues
- Can disable city anytime if problems arise
- Users verify schedules with signs anyway

**Ship fast, iterate based on real feedback** 🚀
