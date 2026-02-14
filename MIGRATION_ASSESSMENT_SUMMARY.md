# MSC to AA Database Migration Assessment

## Quick Answer: Is Migration Straightforward or Risky?

### VERDICT: **STRAIGHTFORWARD MIGRATION** ✅

**Risk Level:** LOW-TO-MEDIUM (depends entirely on PostGIS RPC setup)

---

## Why It's Straightforward

1. **No write operations to migrate**
   - Only reads from street_cleaning_schedule
   - No complex ETL, triggers, or stored procedures in app code
   - Just need to copy data once

2. **Well-contained scope**
   - Only 7 files use MSC database
   - All in pages/api or lib directories
   - Same table exists in both databases already
   - No cross-database joins

3. **Simple query patterns**
   - All queries use basic WHERE (eq), range (gte/lte), order, limit
   - No complex aggregations or GROUP BY
   - Standard Supabase client operations

4. **No app-side complexity**
   - Uses standard Supabase PostgREST API
   - Uses two standard PostGIS RPC functions
   - No custom database triggers or functions in app code
   - Pagination already handled for 1000+ rows

---

## What Could Go Wrong (And How to Prevent It)

### Critical Requirement 1: PostGIS RPC Functions
**Must exist in AA database:**
```sql
find_section_for_point(lon, lat)
get_nearest_street_cleaning_zone(lat, lng, max_distance_meters)
```

**If missing:**
- 3 of 7 MSC-dependent endpoints will fail
- Error: "Procedure find_section_for_point not found"
- **Fix:** Create these functions in AA database using same logic as MSC

**Impact:** BLOCKING - High Risk if not verified first

---

### Critical Requirement 2: PostGIS Geometry Support
**Columns that must exist:**
- `geom` (full geometry polygon)
- `geom_simplified` (simplified geometry)

**If missing or invalid:**
- Map visualization endpoints fail
- Alternative parking finder fails
- Zone boundaries not returned
- **Fix:** Ensure geometry columns are properly indexed PostGIS types

**Impact:** BLOCKING - High Risk if schema mismatch

---

### Important Requirement 3: Data Sync
**Must have identical street_cleaning_schedule data:**
- All 50 wards × all sections must match
- cleaning_date values must be identical
- Block boundary fields (north_block, etc.) must match
- Geometry must be valid and match

**If data differs:**
- Users see different information
- Different addresses resolve to different wards
- Map shows incomplete zones
- **Fix:** Full data copy + validation before cutover

**Impact:** MEDIUM - Data availability issue if not synced

---

### Performance Consideration
**Current MSC database is optimized:**
- PostGIS spatial indexes
- Query results cached in app
- get-street-cleaning-data.ts batches in 1000-row chunks
- Alternative parking uses haversine math (not PostGIS distance)

**If AA database not optimized:**
- Endpoints may be slower
- Map loading may take longer
- No blocking failure, but user experience degradation
- **Fix:** Add spatial indexes after migration

**Impact:** LOW - Degradation, not failure

---

## Migration Checklist

### Pre-Migration (Day -1)
- [ ] Check MSC database for RPC function definitions (SQL DDL)
- [ ] Check AA database for RPC function definitions
- [ ] List all migration steps needed for missing functions
- [ ] Verify AA database has street_cleaning_schedule table
- [ ] Count total rows in MSC street_cleaning_schedule
- [ ] Validate geometry in both databases using ST_IsValid()

### Day 0: Data Migration
- [ ] Schedule during low-traffic window (2-4 AM Chicago time)
- [ ] Copy all street_cleaning_schedule records: `INSERT INTO aa_db.street_cleaning_schedule SELECT * FROM msc_db.street_cleaning_schedule`
- [ ] Verify row counts match exactly
- [ ] Spot-check 10 random ward/section combos for data accuracy
- [ ] Verify geometry validity in AA database

### Day 0: Function Deployment
- [ ] Deploy PostGIS RPC functions to AA database if missing
- [ ] Test each function with known test data
- [ ] Verify performance with SELECT count FROM street_cleaning_schedule

### Day 0: Code Changes (Optional but Recommended)
- [ ] Update 7 files to use main supabase client instead of MSC client
- [ ] Simplify code by removing dual-database logic
- [ ] Remove MSC_SUPABASE_* environment variables from code

### Day 1: Testing
- [ ] Test validate-address.ts with 5+ real Chicago addresses
- [ ] Test find-section.ts with known ward/section combos
- [ ] Verify map loads all zones without timeouts
- [ ] Test find-alternative-parking.ts returns results
- [ ] Run street-cleaning/process.ts notification job manually
- [ ] Check user_notifications table for new entries
- [ ] Test get-zone-geometry.ts batch requests
- [ ] Verify GPS coordinate matching (library function)

### Day 2: Monitoring
- [ ] Monitor API error rates (watch for 500 errors)
- [ ] Monitor notification delivery (SMS/email/voice logs)
- [ ] Monitor API response times
- [ ] Check user feedback channels
- [ ] Review database query logs for errors

### Day 7: Stability Check
- [ ] Run all tests again
- [ ] Check notification logs for full week
- [ ] Verify no data corruption
- [ ] Performance metrics stable
- [ ] Ready to decommission MSC database

---

## Time Estimate

| Task | Time |
|------|------|
| Pre-migration verification | 1-2 hours |
| RPC function deployment (if needed) | 1-2 hours |
| Data copy + validation | 30 minutes |
| Code updates (7 files) | 30 minutes |
| Testing (all endpoints) | 1-2 hours |
| Deployment | 15 minutes |
| First-day monitoring | 4 hours |
| **Total** | **6-10 hours** |

---

## Rollback Plan

If something fails during testing or deployment:

```
1. Don't delete MSC data - keep both databases intact
2. Revert code changes (takes 5 minutes)
3. Re-enable MSC_SUPABASE_* environment variables
4. Redeploy code with MSC database references
5. Verify endpoints work again
6. Investigate root cause
7. Fix issue and retry migration
```

Rollback time: **15 minutes** with zero user impact if caught immediately

---

## Files You'll Touch

### Must Update (7 files):
1. `/lib/street-cleaning-schedule-matcher.ts` - Change MSC client to AA client
2. `/pages/api/validate-address.ts` - Change MSC client to AA client
3. `/pages/api/get-street-cleaning-data.ts` - Change MSC client to AA client
4. `/pages/api/find-section.ts` - Change MSC client to AA client
5. `/pages/api/find-alternative-parking.ts` - Change MSC client to AA client
6. `/pages/api/get-zone-geometry.ts` - Change MSC client to AA client
7. `.env` / `.env.production` - Remove MSC_SUPABASE_* variables

### Already Using AA Database (no changes needed):
- `/pages/api/get-cleaning-schedule.ts` - Already uses main database
- `/pages/api/street-cleaning/process.ts` - Already uses main database

### Verification Files (read-only, no changes):
- `/lib/supabase.ts` - Check client configuration
- `/lib/database.types.ts` - Verify types exist for street_cleaning_schedule

---

## Success Criteria

✅ All endpoints return 200 OK
✅ No new 500 errors in logs
✅ Address validation resolves to correct ward/section
✅ Map renders all zones within 3 seconds
✅ Alternative parking suggestions include expected zones
✅ Zone geometries load correctly
✅ Notifications send at scheduled times
✅ User feedback indicates no issues

---

## Why This Is NOT High Risk

| Potential Risk | Why It's Low |
|---|---|
| **Data loss** | No deletes/updates, only selective copy |
| **Incompatible schema** | Table already exists in AA database with same columns |
| **Breaking queries** | All queries use standard Supabase API (no custom SQL) |
| **Performance regression** | Current MSC database not heavily optimized; query patterns are simple |
| **Availability** | Only affects street cleaning feature, not core app (auth, payments, etc.) |
| **Deployment complexity** | Just update environment variables + redeploy code |

---

## Why This COULD Be Medium Risk

| Potential Risk | How to Mitigate |
|---|---|
| **Missing RPC functions** | Verify functions exist BEFORE migrating data |
| **Invalid geometry** | Run ST_IsValid() on all geometries before cutover |
| **Data mismatch** | Spot-check 20+ random rows after copy |
| **Slow queries** | Add spatial indexes to AA database |
| **User confusion** | Notify users of any visible changes (there shouldn't be any) |

---

## Recommendation

### Proceed with migration IF:
✅ PostGIS RPC functions exist (or can be created) in AA database
✅ AA database has proper geometry column support
✅ You can allocate 6-10 hours for testing and monitoring
✅ Street cleaning is not revenue-critical feature
✅ You have database admin access to both systems

### Delay migration IF:
❌ Unsure about RPC function availability
❌ Geometry columns might be missing in AA database
❌ Can't allocate time for thorough testing
❌ Street cleaning is actively driving revenue
❌ Don't have database admin access

---

## Contact Points for Questions

If unsure about anything, check:
1. **RPC functions:** Query `information_schema.routines` in both databases
2. **Geometry support:** Check if PostGIS extension is installed (`SELECT * FROM pg_extension WHERE extname='postgis'`)
3. **Data validation:** Compare row counts and spot-check random records
4. **Performance:** Use `EXPLAIN ANALYZE` on critical queries before migration

