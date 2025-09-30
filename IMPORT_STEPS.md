# Fix TicketlessAmerica Import

## Problem
Table structure doesn't match between MSC and TicketlessAmerica

## Solution

### Step 1: Fix Table Structure (2 minutes)

1. Go to TicketlessAmerica SQL Editor:
   https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql

2. Copy and run the entire SQL script from:
   `sql/fix-ticketless-table-structure.sql`

   This will:
   - Drop the old table
   - Create new table with exact MSC structure (25 columns)
   - Enable PostGIS for geometry support
   - Add indexes for performance
   - Disable RLS for import

### Step 2: Import Data (1 minute)

1. Go to TicketlessAmerica Table Editor:
   https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/editor

2. Select `street_cleaning_schedule` table (now empty and correctly structured)

3. Click "Insert" → "Import data from CSV"

4. Upload: `/home/randy-vollrath/Downloads/street_cleaning_FIXED.csv`

5. Wait for import to complete (~8,544 rows)

### Done!

Both databases will have:
- ✅ 8,544 clean rows
- ✅ Geometry data for maps
- ✅ Correct 2025-2026 dates for notifications
- ✅ All boundary street information
- ✅ No duplicates

Maps, address lookup, and notifications will all work!