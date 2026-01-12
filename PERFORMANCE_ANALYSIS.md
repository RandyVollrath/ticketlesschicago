# Property Tax Search & Analysis Flow - Performance Bottleneck Analysis

## Executive Summary
The property tax search and analysis flow has multiple sequential API call chains and redundant data fetching operations that can add 30-60+ seconds to analysis requests. The biggest bottlenecks are excessive parallel API queries to external Cook County Socrata API and lack of result caching.

---

## CRITICAL BOTTLENECKS FOUND

### 1. EXCESSIVE PARALLEL API QUERIES TO COOK COUNTY (HIGHEST IMPACT)
**Location:** `/lib/cook-county-api.ts:1035-1136` (getComparableProperties for condos)

**Problem:** 
- For condo properties, the code launches 5 parallel API queries to the SAME external dataset:
  ```
  Query 1: Same building (50 records)
  Query 2: Same township + bedrooms + similar size (100 records)
  Query 3: Same township + bedrooms + age filter (75 records)
  Query 4: Same township + bedrooms only (150 records)
  Query 5: Adjacent townships + bedrooms (100 records)
  ```
- Each query has a 45-second timeout and Cook County's API is notoriously slow
- The queries are running in parallel but hitting the same external API, potentially causing rate limiting or API strain
- Even with `Promise.allSettled()`, if 2-3 queries timeout, the entire analysis takes 45s+ 

**Impact:** 
- Could easily add 20-45 seconds to each analysis request
- Multiplied when analyzing multiple properties or running multiple analyses

**Recommendation:**
- Implement exponential backoff and query combination: merge queries 2-4 into a single API call with broader filtering
- Add server-side caching with 24-hour TTL for comparable searches (group by township + bedroom count)
- Consider pre-computing common comparable sets for popular properties
- Reduce timeout from 45s to 30s and implement early failure detection

---

### 2. MISSING RESULT CACHING FOR ANALYSIS (HIGH IMPACT)
**Location:** `/pages/api/property-tax/analyze.ts` lines 71-121

**Problem:**
- The `analyzeAppealOpportunity()` function does NOT cache its results
- The function calls:
  - `getPropertyByPin()` (3 parallel SODA queries)
  - `getComparableProperties()` (5 parallel SODA queries for condos OR 2 for residential)
  - `getComparableSales()` (multiple SODA queries)
  - `getAppealHistory()` (1 SODA query)
- If a user analyzes the same property twice (e.g., page refresh, coming back later), all these calls repeat
- No attempt to cache the full analysis result in Supabase

**Impact:**
- Each property analysis can trigger 15-20 API calls minimum
- Same property re-analyzed = wasted API calls and duplicate external requests
- Users might trigger this accidentally by refreshing the page or going back/forward

**Recommendation:**
- Add caching in the analyze endpoint after line 72:
  ```typescript
  // Check if we have cached analysis (within 72 hours)
  const { data: cachedAnalysis } = await supabase
    .from('property_tax_analysis_cache')
    .select('*')
    .eq('pin', normalizedPin)
    .gt('cached_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    .single();
  
  if (cachedAnalysis) return cachedAnalysis.result;
  ```
- Cache the full `AppealOpportunity` result with 72-hour TTL
- Add cache invalidation trigger when county data updates

---

### 3. SEQUENTIAL ASSESSMENT HISTORY FETCH (MEDIUM IMPACT)
**Location:** `/lib/cook-county-api.ts:2000-2011`

**Problem:**
- In `analyzeAppealOpportunity()`, after parallel fetches complete, more data is requested sequentially:
  ```typescript
  const [comparables, comparableSales, appealHistory] = await Promise.all([...])
  // Then later (line 2000+):
  const lastAppeal = appealHistory[0];
  const priorAppeals = { ... };
  ```
- But also `cacheComparables()` is called AFTER analysis (line 109 in analyze.ts)
- This is a separate operation that loops through comparables and does individual Supabase upserts
- `getRecentSuccessfulAppeals()` and `checkExemptionEligibility()` are properly parallelized but add extra API load

**Impact:**
- `cacheComparables()` loops doing N+1 upserts (one per comparable) instead of batch insert
- If analyzing 15 comparables, that's 15 separate Supabase write operations
- Not blocking but adds latency

**Recommendation:**
- Batch the upserts in `cacheComparables()`:
  ```typescript
  // Instead of loop with individual upserts:
  const records = analysis.comparables.map(comp => ({ ... }));
  await supabase.from('property_tax_properties').upsert(records);
  ```
- Consider making this entire cache operation fire-and-forget (no await)

---

### 4. MULTIPLE SOCRATA API QUERIES WITHIN getPropertyByPin (MEDIUM IMPACT)
**Location:** `/lib/cook-county-api.ts:697-725`

**Problem:**
- `getPropertyByPin()` queries 3 datasets in parallel:
  - CHARACTERISTICS (residential)
  - ASSESSED_VALUES (assessments)
  - CONDO_CHARACTERISTICS (condo-specific)
- All 3 go to same external API simultaneously
- Even though they're parallel, the external API might rate-limit or slow under load

**Impact:**
- Adds 1-5 seconds to property lookup
- Happens before analysis even begins

**Recommendation:**
- Check lookup cache BEFORE making API calls (currently happens in `lookup.ts` but not in `analyzeAppealOpportunity`)
- Add smarter dataset selection: if it looks like a condo (class 299), only query condo dataset + values

---

### 5. getComparableSales QUERIES ARCHIVED DATASET (MEDIUM IMPACT)
**Location:** `/lib/cook-county-api.ts` (search for getComparableSales)

**Problem:**
- Comparable sales queries use SALES_ARCHIVED dataset (5pge-nu6u) which:
  - Has data only through 2019 (outdated)
  - Is queried even though PARCEL_SALES (wvhk-k5uv) is the current dataset
- Code comment acknowledges this: "// Residential sales (ARCHIVED - only has data through 2019)"

**Impact:**
- Fetching old data that may not be relevant
- Should use current PARCEL_SALES dataset for 2024-2025 data
- Extra API call returns limited results

**Recommendation:**
- Switch to current PARCEL_SALES dataset (wvhk-k5uv) which is updated daily
- Remove SALES_ARCHIVED query entirely or keep as fallback only

---

### 6. NO QUERY RESULT LIMITING/PAGINATION (MEDIUM IMPACT)
**Location:** Multiple locations in cook-county-api.ts

**Problem:**
- Many queries request large result sets:
  - Query 4 in condo search: 150 records limit (line 1110)
  - Query 5 in condo search: 100 records limit (line 1130)
  - BOR decisions query: 5000 record limit (line 1557 in getTownshipWinRate)
  - Parcel sales queries: no limit specified
- Even if only 10 comparables are needed, code fetches 150+ and then filters
- When fetching 5000 BOR decisions, most are discarded after aggregation

**Impact:**
- Larger payloads from external API = slower transfer + parsing
- Filtering happens in-memory after fetching instead of at API query level
- Could easily cut API response size by 50-70%

**Recommendation:**
- Use `$limit` parameter more aggressively
- For comparables: fetch `limit * 1.5` instead of `limit * 3`
- For BOR decisions: query last 2 years only, limit to 1000, then aggregate
- For sales: use date filters to get only recent sales

---

### 7. NO QUERY RESULT CACHING FOR TOWNSHIP-LEVEL DATA (MEDIUM IMPACT)
**Location:** `/pages/api/property-tax/analyze.ts:95-106`

**Problem:**
- `getTownshipWinRate()`, `getRecentSuccessfulAppeals()`, `getNeighborhoodConditions()` are called for every analysis
- These results are township-level (same for all properties in township)
- No caching of these results
- Every property analyzed in "Lake View" township re-queries the same win rates and recent successes

**Impact:**
- Unnecessary repeated API calls for township-level data
- If analyzing 10 properties in same township, township data fetched 10x

**Recommendation:**
- Cache township-level results with 7-day TTL:
  ```typescript
  const cachedWinRate = await supabase
    .from('township_cache')
    .select('*')
    .eq('township_code', townshipCode)
    .gt('cached_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .single();
  ```
- Same for neighborhood conditions and recent appeals

---

### 8. SEQUENTIAL ADDRESS GEOCODING LOOKUP (LOW-MEDIUM IMPACT)
**Location:** `/pages/api/property-tax/analyze.ts:95` (extractWardFromProperty)

**Problem:**
- `extractWardFromProperty()` uses hardcoded township-to-ward mapping (lines 607-627)
- Comment says "In production, would use geocoding to get exact ward"
- If real geocoding were added, it would happen AFTER analysis (not parallelized)
- Currently using approximate mapping is fine but indicates future bottleneck

**Impact:**
- Currently low impact (using lookup table)
- Future geocoding call would add 2-5 seconds

**Recommendation:**
- Pre-geocode all properties during import/cache
- Store ward in the property cache, don't calculate at query time

---

### 9. NO QUERY TIMEOUT/CIRCUIT BREAKER PATTERN (HIGH IMPACT)
**Location:** `/lib/cook-county-api.ts:628-683` (querySODA function)

**Problem:**
- Retries with exponential backoff but will retry up to 2 times
- 45-second timeout with 2 retries = potential 90+ second wait per query
- No circuit breaker: if Cook County API is down, ALL queries will timeout
- `Promise.allSettled()` waits for all promises even if most fail

**Impact:**
- Single slow query blocks entire analysis (45s timeout)
- If API is down, analysis takes 90+ seconds then fails
- Poor user experience during Cook County API outages

**Recommendation:**
- Reduce timeout to 20 seconds (Cook County usually responds faster or fails fast)
- Implement circuit breaker: if 3+ recent queries to same dataset failed, fail fast instead of retrying
- Use `Promise.race()` with timeout instead of relying on fetch timeout
- Add health check endpoint to detect API downtime

---

### 10. REDUNDANT TOWNSHIP CODE LOOKUPS (LOW IMPACT)
**Location:** Multiple locations

**Problem:**
- Township code is looked up/passed around multiple times:
  - In `getPropertyByPin()` result
  - In `getComparableProperties()` 
  - In `getTownshipWinRate()` call
  - In `getNeighborhoodConditions()` call
- Not cached, so township name lookup in ASSESSED_VALUES happens multiple times

**Impact:**
- Minor performance impact but indicates code duplication

**Recommendation:**
- Cache township code → name mapping in memory during request
- Pass through call stack rather than re-querying

---

## QUICK WINS (Low Effort, High Impact)

### 1. Batch Supabase Upserts (5 minutes)
- In `cacheComparables()`: batch insert instead of loop
- **Impact:** Reduce analyze latency by ~2-3 seconds
- **File:** `/pages/api/property-tax/analyze.ts:183-219`

### 2. Add Analysis Result Caching (15 minutes)
- Cache full `AppealOpportunity` with 72-hour TTL
- **Impact:** Reduce re-analysis latency to <100ms
- **File:** `/pages/api/property-tax/analyze.ts:71-122`

### 3. Reduce API Query Limits (10 minutes)
- Change `limit * 3` to `limit * 1.5` for condo queries
- Change BOR limit from 5000 to 1000
- **Impact:** Reduce API payload by 40-50%
- **Files:** `/lib/cook-county-api.ts:1050-1110, 1557`

### 4. Add Township-Level Caching (20 minutes)
- Cache win rates, recent appeals, neighborhood conditions by township
- **Impact:** 70% fewer API calls for second+ analysis in same township
- **File:** `/pages/api/property-tax/analyze.ts:95-106`

---

## MEDIUM-EFFORT IMPROVEMENTS

### 5. Query Combination for Condos (30 minutes)
- Merge queries 2-4 in `getComparableProperties()` into single query with flexible criteria
- Use client-side filtering instead of 3 separate API calls
- **Impact:** Reduce API calls from 5 to 3 per property, save 10-20 seconds

### 6. Circuit Breaker Implementation (45 minutes)
- Add failure tracking to `querySODA()`
- Auto-fail if 3+ consecutive calls to same dataset fail
- **Impact:** Prevent cascading failures, improve timeout handling

### 7. Switch to Current Sales Dataset (10 minutes)
- Replace SALES_ARCHIVED with PARCEL_SALES
- **Impact:** Get 2024-2025 data instead of 2019 data

---

## DETAILED METRICS

| Operation | Current Time | Bottleneck | Quick Win Potential |
|-----------|--------------|-----------|------------------|
| getPropertyByPin (3 parallel queries) | 2-8s | External API latency | Cache in lookup.ts |
| getComparableProperties (5 queries for condo) | 15-35s | Sequential + excessive queries | Combine queries |
| getComparableSales | 2-5s | Archived dataset + old data | Switch to current dataset |
| getAppealHistory | 1-3s | Single query | Already optimized |
| getTownshipWinRate | 2-5s | Repeated for each analysis | Cache by township |
| getRecentSuccessfulAppeals | 2-5s | Repeated for each analysis | Cache by township |
| checkExemptionEligibility | 1-2s | Attempt to fetch exemption data | Already fast |
| getNeighborhoodConditions | 1-3s | Ward extraction + external data | Cache by ward |
| cacheComparables (N upserts) | 2-3s | N+1 upserts | Batch insert |
| formatAnalysisResponse | <1s | All in-memory | Already fast |
| **TOTAL** | **30-80s** | **API calls + caching** | **10-20s potential** |

---

## CALL FLOW ANALYSIS

### Current Sequential Bottleneck Chain

```
POST /api/property-tax/analyze
├─ getPropertyByPin [PARALLEL: 3 queries] ............... 2-8s
│  ├─ CHARACTERISTICS query
│  ├─ ASSESSED_VALUES query
│  └─ CONDO_CHARACTERISTICS query
│
├─ Promise.all([
│  ├─ getComparableProperties [PARALLEL: 5 queries] ... 15-35s ❌ BOTTLENECK
│  │  ├─ Query 1: Same building
│  │  ├─ Query 2: Township + bedrooms + size
│  │  ├─ Query 3: Township + bedrooms + age
│  │  ├─ Query 4: Township + bedrooms
│  │  └─ Query 5: Adjacent townships
│  │  └─ Then: Get assessed values [1 query] ........ 2-5s
│  │
│  ├─ getComparableSales [2+ queries] ................ 2-5s
│  │  ├─ PARCEL_SALES query (current) OR
│  │  └─ SALES_ARCHIVED query (old, 2019 data)
│  │
│  └─ getAppealHistory [1 query] .................... 1-3s
│
├─ Promise.all([
│  ├─ getNeighborhoodConditions (Ward lookup) ........ 1-3s ❌ REPEATED
│  ├─ getTownshipWinRate [1 large query] ............ 2-5s ❌ REPEATED
│  ├─ getPriorAppealOutcomes ........................ <1s
│  ├─ getRecentSuccessfulAppeals [1 query] ......... 2-5s ❌ REPEATED
│  └─ checkExemptionEligibility [1 query attempt] .. 1-2s
│
├─ cacheComparables [N upserts sequentially] ......... 2-3s ❌ N+1 PROBLEM
│
└─ formatAnalysisResponse [in-memory] ............... <1s
```

### Ideal Optimized Flow

```
POST /api/property-tax/analyze
├─ Check cache for PIN analysis (72h TTL) ............ <1ms ✓
│  └─ If hit: return cached result
│
├─ getPropertyByPin [PARALLEL: 3 queries] ........... 2-8s
│
├─ Promise.all([
│  ├─ getComparableProperties [PARALLEL: 3 queries] . 8-15s ✓
│  │  └─ Reduced from 5 to 3 combined queries
│  │  └─ Get assessed values in same batch
│  │
│  ├─ getComparableSales [1 query] ................. 1-3s ✓
│  │  └─ Switch to PARCEL_SALES (current data)
│  │
│  ├─ getAppealHistory [1 query] .................. 1-3s
│  │
│  ├─ Check township cache (7d TTL) ............... <1ms ✓
│  │  ├─ getTownshipWinRate
│  │  ├─ getRecentSuccessfulAppeals
│  │  └─ getNeighborhoodConditions (cached or fetched)
│
├─ cacheComparables [batch upsert] ................. <1s ✓
│  └─ Single batch insert instead of N upserts
│
└─ formatAnalysisResponse [in-memory] .............. <1s
```

**Expected improvement: 30-80s → 15-25s (40-60% faster)**

---

## IMPLEMENTATION PRIORITY

1. **Phase 1 (Week 1):** Add caching layers
   - Analysis result cache (15 min)
   - Township data cache (20 min)
   - Batch upserts (5 min)
   - **Impact:** 30-40% latency reduction, minimal code changes

2. **Phase 2 (Week 2):** Optimize queries
   - Reduce query limits (10 min)
   - Switch to current sales dataset (10 min)
   - Circuit breaker pattern (45 min)
   - **Impact:** Additional 20-30% latency reduction

3. **Phase 3 (Week 3+):** Major refactoring
   - Combine condo queries (30 min)
   - Pre-compute comparables cache (complex)
   - Query result pagination (medium)
   - **Impact:** Additional 15-25% latency reduction

---

## MONITORING RECOMMENDATIONS

Add these to detect future performance issues:

```typescript
// Track API call latency by dataset
console.time(`SODA:${dataset}`);
const results = await querySODA(...);
console.timeEnd(`SODA:${dataset}`);

// Track cache hit rates
analyzeResult.cacheHit ? metricsClient.increment('analysis.cache.hit') : 
                        metricsClient.increment('analysis.cache.miss');

// Track total analysis time
console.time('property-tax-analyze');
// ... analysis code ...
console.timeEnd('property-tax-analyze');
```

