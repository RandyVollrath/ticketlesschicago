-- Add mail service columns to ticket_contests table

ALTER TABLE ticket_contests
  ADD COLUMN IF NOT EXISTS mail_service_requested BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS mail_service_payment_intent TEXT,
  ADD COLUMN IF NOT EXISTS mail_service_payment_status TEXT CHECK (mail_service_payment_status IN ('pending', 'paid', 'failed')),
  ADD COLUMN IF NOT EXISTS mail_service_amount DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS mailing_address JSONB, -- {name, address, city, state, zip}
  ADD COLUMN IF NOT EXISTS lob_mail_id TEXT,
  ADD COLUMN IF NOT EXISTS mail_status TEXT CHECK (mail_status IN ('pending', 'sent', 'in_transit', 'delivered', 'failed')),
  ADD COLUMN IF NOT EXISTS mail_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS mail_tracking_url TEXT;

-- Create index on payment intent for webhook lookups
CREATE INDEX IF NOT EXISTS ticket_contests_payment_intent_idx ON ticket_contests(mail_service_payment_intent);

-- Create index on lob_mail_id for tracking lookups
CREATE INDEX IF NOT EXISTS ticket_contests_lob_mail_id_idx ON ticket_contests(lob_mail_id);
