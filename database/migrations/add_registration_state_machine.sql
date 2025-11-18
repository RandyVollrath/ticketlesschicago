-- Registration State Machine
-- Tracks the lifecycle of vehicle registration requests

-- Create registration_state enum
CREATE TYPE registration_state AS ENUM (
  'idle',                    -- User hasn't started
  'started',                 -- User clicked "Register my vehicle"
  'needs_info',              -- Missing required information (DL, insurance, etc.)
  'info_complete',           -- All info provided, ready to submit
  'awaiting_submission',     -- Queued for remitter to submit
  'submitted',               -- Remitter submitted to Illinois SOS
  'processing',              -- State is processing the registration
  'delayed',                 -- Processing delayed (waiting on state)
  'completed',               -- Registration complete, plates issued
  'failed',                  -- Registration failed (rejected by state)
  'cancelled'                -- User cancelled the registration
);

-- Add state field to registrations table (if it exists)
-- If you don't have a registrations table yet, we'll create it
DO $$
BEGIN
  -- Check if registrations table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'registrations') THEN
    -- Table exists, add state column if it doesn't exist
    IF NOT EXISTS (SELECT FROM information_schema.columns
                   WHERE table_name = 'registrations' AND column_name = 'state') THEN
      ALTER TABLE registrations ADD COLUMN state registration_state DEFAULT 'idle';
      ALTER TABLE registrations ADD COLUMN state_changed_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE registrations ADD COLUMN state_changed_by TEXT; -- user_id or 'system' or 'remitter'
      ALTER TABLE registrations ADD COLUMN state_notes TEXT; -- Reason for state change
    END IF;
  ELSE
    -- Table doesn't exist, create it with state tracking
    CREATE TABLE registrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,

      -- Vehicle info
      vin TEXT,
      plate TEXT,
      plate_state TEXT DEFAULT 'IL',

      -- Required documents
      drivers_license_front TEXT, -- URL to uploaded image
      drivers_license_back TEXT,
      insurance_card TEXT,
      title_document TEXT,

      -- State machine
      state registration_state DEFAULT 'idle' NOT NULL,
      state_changed_at TIMESTAMP DEFAULT NOW(),
      state_changed_by TEXT, -- user_id, 'system', or 'remitter'
      state_notes TEXT,

      -- City confirmation
      city_confirmation_number TEXT,

      -- Timestamps
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      submitted_at TIMESTAMP,
      completed_at TIMESTAMP
    );

    CREATE INDEX idx_registrations_user_id ON registrations(user_id);
    CREATE INDEX idx_registrations_state ON registrations(state);
    CREATE INDEX idx_registrations_state_changed_at ON registrations(state_changed_at DESC);
  END IF;
END $$;

-- Create state transition history table
CREATE TABLE IF NOT EXISTS registration_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL,

  -- State transition
  from_state registration_state,
  to_state registration_state NOT NULL,

  -- Who/what changed it
  changed_by TEXT NOT NULL, -- user_id, 'system', 'remitter', or 'admin'
  reason TEXT, -- Human-readable reason for change

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_registration_state_history_registration_id ON registration_state_history(registration_id);
CREATE INDEX idx_registration_state_history_created_at ON registration_state_history(created_at DESC);

-- Create trigger to log state changes
CREATE OR REPLACE FUNCTION log_registration_state_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if state actually changed
  IF OLD.state IS DISTINCT FROM NEW.state THEN
    INSERT INTO registration_state_history (
      registration_id,
      from_state,
      to_state,
      changed_by,
      reason,
      metadata
    ) VALUES (
      NEW.id,
      OLD.state,
      NEW.state,
      NEW.state_changed_by,
      NEW.state_notes,
      jsonb_build_object(
        'old_state', OLD.state,
        'new_state', NEW.state,
        'user_id', NEW.user_id
      )
    );

    -- Update state_changed_at
    NEW.state_changed_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if registrations table has state column
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns
             WHERE table_name = 'registrations' AND column_name = 'state') THEN
    DROP TRIGGER IF EXISTS registration_state_change_trigger ON registrations;
    CREATE TRIGGER registration_state_change_trigger
      BEFORE UPDATE ON registrations
      FOR EACH ROW
      EXECUTE FUNCTION log_registration_state_change();
  END IF;
END $$;

-- Comments
COMMENT ON TYPE registration_state IS 'State machine for vehicle registration lifecycle';
COMMENT ON TABLE registration_state_history IS 'Audit log of all registration state transitions';
COMMENT ON COLUMN registrations.state IS 'Current state in the registration lifecycle';
COMMENT ON COLUMN registrations.state_changed_at IS 'When the state last changed';
COMMENT ON COLUMN registrations.state_changed_by IS 'Who/what changed the state (user_id, system, remitter, admin)';
COMMENT ON COLUMN registrations.state_notes IS 'Human-readable reason for state change';

-- Valid state transitions (documentation)
-- idle → started (user clicks "Register")
-- started → needs_info (system detects missing info)
-- needs_info → info_complete (user uploads all docs)
-- info_complete → awaiting_submission (ready for remitter)
-- awaiting_submission → submitted (remitter submits to state)
-- submitted → processing (state receives submission)
-- processing → completed (state issues plates)
-- processing → delayed (state requests more time)
-- delayed → processing (delay resolved)
-- * → failed (any state can fail)
-- * → cancelled (user can cancel at any time)
