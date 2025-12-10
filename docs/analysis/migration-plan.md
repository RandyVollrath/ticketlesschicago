# 🚨 STREET CLEANING DATA MIGRATION PLAN
## Systematic Fix for Ticketless America Notifications

### CRITICAL ISSUES IDENTIFIED
- **40% Data Loss**: 229/568 zones missing future cleaning schedules
- **Data Corruption**: Invalid dates from year 0205 to 2925
- **0% System Reliability**: Cross-database integration completely broken
- **Zero User Coverage**: No users have valid street cleaning addresses

### RECOMMENDED SOLUTION: MIGRATE TO SINGLE DATABASE

## Phase 1: Data Cleanup & Validation (Day 1)

### 1.1 Clean MSC Source Data
```sql
-- Remove corrupted date records
DELETE FROM street_cleaning_schedule 
WHERE cleaning_date < '2025-01-01' OR cleaning_date > '2026-12-31';

-- Validate ward/section combinations
UPDATE street_cleaning_schedule 
SET ward = TRIM(ward), section = TRIM(section)
WHERE ward IS NOT NULL AND section IS NOT NULL;
```

### 1.2 Create Clean Export
```javascript
// Export only valid, current data
const cleanData = await mscSupabase
  .from('street_cleaning_schedule')
  .select('*')
  .gte('cleaning_date', '2025-01-01')
  .lte('cleaning_date', '2026-12-31')
  .not('ward', 'is', null)
  .not('section', 'is', null)
  .not('geom_simplified', 'is', null);
```

## Phase 2: Database Migration (Day 1-2)

### 2.1 Create Table in Ticketless America DB
```sql
CREATE TABLE public.street_cleaning_schedule (
  id BIGSERIAL PRIMARY KEY,
  ward TEXT NOT NULL,
  section TEXT NOT NULL,
  cleaning_date DATE NOT NULL,
  geom_simplified JSONB,
  street_name TEXT,
  side TEXT,
  east_block TEXT,
  west_block TEXT,
  north_block TEXT,
  south_block TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_street_cleaning_ward_section ON street_cleaning_schedule(ward, section);
CREATE INDEX idx_street_cleaning_date ON street_cleaning_schedule(cleaning_date);
CREATE INDEX idx_street_cleaning_geom ON street_cleaning_schedule USING GIN(geom_simplified);
```

### 2.2 Import Clean Data
- Batch import validated records
- Verify geometry data integrity
- Confirm date ranges are correct

## Phase 3: API Updates (Day 2)

### 3.1 Update Environment Variables
```bash
# Remove MSC database variables
# MSC_SUPABASE_URL=...
# MSC_SUPABASE_SERVICE_ROLE_KEY=...

# Use single Ticketless America database
NEXT_PUBLIC_SUPABASE_URL=https://dzhqolbhuqdcpngdayuq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### 3.2 Update API Endpoints
```typescript
// pages/api/get-street-cleaning-data.ts
// Remove MSC client, use single supabase client
const { data: allZones } = await supabase
  .from('street_cleaning_schedule')
  .select('ward, section, geom_simplified')
  .not('geom_simplified', 'is', null);
```

### 3.3 Remove Cross-Database Complexity
- Remove MSC environment variable handling
- Simplify error handling
- Remove duplicate client configurations

## Phase 4: User Address Validation (Day 3)

### 4.1 Fix Address-to-Ward/Section Mapping
```typescript
// Verify geocoding API integration
// Test address lookup against new local table
// Fix ward/section assignment logic
```

### 4.2 Validate Existing User Addresses
```sql
-- Check which users have valid ward/section combinations
SELECT u.email, u.home_address_ward, u.home_address_section
FROM user_profiles u
LEFT JOIN street_cleaning_schedule s 
  ON u.home_address_ward = s.ward 
  AND u.home_address_section = s.section
WHERE u.home_address_ward IS NOT NULL 
  AND s.ward IS NULL;
```

## Phase 5: Notification System Testing (Day 3-4)

### 5.1 Test Notification Queries
```typescript
// Test zero-day notifications
const { data: users } = await supabase
  .from('report_zero_day')
  .select('*');

// Verify users get matched to cleaning schedules
```

### 5.2 End-to-End Testing
- Test Randy's Ward 43, Section 1 address
- Verify notification timing and content
- Test all notification types (email, SMS, voice)

## Phase 6: Production Deployment (Day 4)

### 6.1 Deploy Updated APIs
- Deploy single-database version
- Monitor error rates
- Verify map functionality

### 6.2 Data Sync Strategy (Optional)
```typescript
// If MSC needs periodic updates, create sync job
async function syncFromMSC() {
  // Export from MSC, clean, import to TA
  // Run weekly or monthly
}
```

## BENEFITS OF THIS APPROACH

### ✅ Immediate Fixes
- **100% reliability**: Single database, no cross-database failures
- **Zero data loss**: All valid zones appear correctly
- **Accurate dates**: Corrupted data cleaned during migration
- **User coverage**: Address mapping will work properly

### ✅ Long-term Benefits
- **Simpler maintenance**: One database to manage
- **Better performance**: Local queries, no network latency
- **Easier debugging**: All data in one place
- **RLS integration**: Better security with single database
- **Cost efficiency**: Potentially lower Supabase costs

### ✅ Development Benefits
- **Simpler code**: Remove cross-database complexity
- **Better testing**: Local data makes testing easier
- **Fewer environment variables**: Reduced configuration
- **Faster development**: No cross-database debugging

## MIGRATION TIMELINE
- **Day 1**: Data cleanup and export from MSC
- **Day 2**: Import to TA database, update APIs
- **Day 3**: Fix user address validation, test notifications
- **Day 4**: Deploy to production, verify functionality

## ROLLBACK PLAN
- Keep MSC database credentials as backup
- Can revert API changes if issues arise
- Maintain parallel data until confidence is high

## NEXT STEPS
1. **Get approval** for migration approach
2. **Schedule maintenance window** for migration
3. **Export clean data** from MSC database
4. **Execute migration** following this plan