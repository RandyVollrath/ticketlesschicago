-- Rename witness_statements to be clearer about what it contains
-- Safe: preserves all existing data

-- Rename the column
ALTER TABLE ticket_contests
RENAME COLUMN witness_statements TO written_statement;

-- Update the comment to clarify usage
COMMENT ON COLUMN ticket_contests.written_statement IS
'Written statement - can be from the user themselves OR from a witness.
Format: "I, [Name], witnessed the following..." or personal account of events.
This is NOT in-person testimony - it''s written text that accompanies the letter.';

-- Note: All existing data is preserved. No data changes needed.
