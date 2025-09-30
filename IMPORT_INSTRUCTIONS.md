# Street Cleaning Data Import Instructions

## Problem
We need geometry data (for maps) + correct dates (for notifications) in both databases.

## Solution (2 Steps)

### Step 1: Import Geometry CSV via Supabase Dashboard

**For MSC Database:**
1. Go to: https://supabase.com/dashboard/project/zqljxkqdgfibfzdjfjiq/editor
2. Click on `street_cleaning_schedule` table
3. Click "Insert" dropdown → "Import data from CSV"
4. Select file: `/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv`
5. Click "Import" and wait for completion (~8,848 rows)

**For TicketlessAmerica Database:**
1. Go to: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/editor
2. Click on `street_cleaning_schedule` table
3. Click "Insert" dropdown → "Import data from CSV"
4. Select same file: `/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv`
5. Click "Import" and wait for completion

### Step 2: Fix Dates with SQL Script

After importing, run this command in the `ticketless-chicago` directory:

```bash
node scripts/update-dates-after-import.js
```

This will:
- Keep all the geometry data intact
- Update only the cleaning_date field with correct 2025-2026 dates
- Update ward_section composite key

## Result

✅ Maps will work (geometry data)
✅ Notifications will work (correct dates)
✅ Address lookup will work (geometry + boundaries)

## If Import Fails

If CSV import via dashboard fails, we can use SQL COPY command instead. Let me know!