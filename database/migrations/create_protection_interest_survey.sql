-- Create table to track Protection tier interest survey responses

CREATE TABLE IF NOT EXISTS protection_interest_survey (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  interests JSONB NOT NULL,
  price_willing TEXT,
  additional_feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add index on email for lookups
CREATE INDEX IF NOT EXISTS idx_protection_interest_email ON protection_interest_survey(email);

-- Add index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_protection_interest_created_at ON protection_interest_survey(created_at);
