-- Add permit zone document verification system
-- This enables users to upload ID and proof of residency for permit zone sticker purchases

CREATE TABLE IF NOT EXISTS permit_zone_documents (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  -- Document details
  id_document_url TEXT NOT NULL,
  id_document_filename TEXT NOT NULL,
  proof_of_residency_url TEXT NOT NULL,
  proof_of_residency_filename TEXT NOT NULL,

  -- Address information
  address TEXT NOT NULL,

  -- Verification status
  verification_status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,

  -- City customer code (once verified)
  customer_code TEXT,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX idx_permit_zone_documents_user_id ON permit_zone_documents(user_id);
CREATE INDEX idx_permit_zone_documents_status ON permit_zone_documents(verification_status);

-- Add permit zone document reference to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_permit_document_id INTEGER REFERENCES permit_zone_documents(id);
