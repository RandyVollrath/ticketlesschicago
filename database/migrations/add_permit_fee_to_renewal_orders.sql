-- Migration: Add permit fee fields and processing timestamps to renewal_orders table
-- Date: 2025-12-04
-- Description: Adds permit_fee, permit_requested, and processing status columns

-- Add permit_fee column (defaults to 0 for existing orders)
ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS permit_fee DECIMAL(10,2) DEFAULT 0;

-- Add permit_requested boolean column (defaults to false for existing orders)
ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS permit_requested BOOLEAN DEFAULT false;

-- Add processing timestamps
ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS city_confirmation_number TEXT;

ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS remitter_notes TEXT;

-- Add renewal due date for remitter reference
ALTER TABLE renewal_orders
ADD COLUMN IF NOT EXISTS renewal_due_date DATE;

-- Create index for filtering by permit status (useful for remitter queries)
CREATE INDEX IF NOT EXISTS idx_renewal_orders_permit_requested
ON renewal_orders(permit_requested)
WHERE permit_requested = true;

-- Create index for filtering by status
CREATE INDEX IF NOT EXISTS idx_renewal_orders_status
ON renewal_orders(status);
