-- App waitlist: capture email + phone from ad traffic before app store launch
CREATE TABLE IF NOT EXISTS app_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  phone TEXT,
  source TEXT DEFAULT 'website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_waitlist_email_unique UNIQUE (email)
);

ALTER TABLE app_waitlist ENABLE ROW LEVEL SECURITY;
