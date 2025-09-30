-- FINAL FIX: Run this in TicketlessAmerica SQL Editor
-- https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql

-- Step 1: Clear existing data
DELETE FROM street_cleaning_schedule;

-- Step 2: Copy data from MSC database
-- NOTE: You'll need to run this from the MSC project's SQL editor,
-- or export CSV from MSC and import to TicketlessAmerica via dashboard

-- ALTERNATIVE: Export/Import via Dashboard (EASIEST)
--
-- 1. MSC Export:
--    Go to: https://supabase.com/dashboard/project/zqljxkqdgfibfzdjfjiq/editor
--    Click street_cleaning_schedule → "..." menu → "Download as CSV"
--
-- 2. TicketlessAmerica Import:
--    Go to: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/editor
--    Click street_cleaning_schedule → "Insert" → "Import data from CSV"
--    Upload the CSV from step 1
--
-- That's it! Both databases will have 8,544 rows with geometry + correct dates