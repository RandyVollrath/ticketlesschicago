-- Complete fix for TicketlessAmerica street_cleaning_schedule
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql

-- Step 1: Disable RLS temporarily
ALTER TABLE street_cleaning_schedule DISABLE ROW LEVEL SECURITY;

-- Step 2: Delete all existing data
DELETE FROM street_cleaning_schedule;

-- Step 3: Import will be done via dashboard CSV import after this
-- (You'll upload: /home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv)

-- Step 4: Re-enable RLS (run this AFTER CSV import)
-- ALTER TABLE street_cleaning_schedule ENABLE ROW LEVEL SECURITY;