-- City Sticker Renewal Intake System
-- Digital renewal orders with document uploads, payments, and partner integration

-- Partner/Remitter accounts (dealerships, currency exchanges, etc.)
CREATE TABLE IF NOT EXISTS renewal_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Partner info
  name TEXT NOT NULL,
  business_type TEXT NOT NULL, -- 'remitter', 'dealership', 'currency_exchange'
  email TEXT NOT NULL UNIQUE,
  phone TEXT,

  -- Business details
  business_address TEXT,
  license_number TEXT, -- City remitter license
  ein TEXT, -- Tax ID

  -- Stripe connected account (for payment forwarding)
  stripe_connected_account_id TEXT UNIQUE,
  stripe_account_status TEXT DEFAULT 'pending', -- pending, active, restricted
  payout_enabled BOOLEAN DEFAULT false,

  -- API integration
  api_key TEXT UNIQUE, -- For pushing data to their system
  webhook_url TEXT, -- Notify partner of new orders
  portal_integration_type TEXT, -- 'api', 'manual', 'csv_export'
  portal_credentials_encrypted TEXT, -- Encrypted creds for auto-posting

  -- Settings
  auto_forward_payments BOOLEAN DEFAULT true,
  commission_percentage DECIMAL(5,2) DEFAULT 0, -- % of each sale they keep
  service_fee_amount DECIMAL(10,2) DEFAULT 0, -- Fixed fee per transaction

  -- Features enabled
  allow_digital_intake BOOLEAN DEFAULT true,
  require_appointment BOOLEAN DEFAULT false,
  allow_walk_in BOOLEAN DEFAULT true,

  -- Status
  status TEXT DEFAULT 'active', -- active, suspended, inactive
  onboarding_completed BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_renewal_partners_status ON renewal_partners(status);
CREATE INDEX idx_renewal_partners_stripe ON renewal_partners(stripe_connected_account_id);

-- Renewal orders (digital intake submissions)
CREATE TABLE IF NOT EXISTS renewal_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL, -- Human-readable: RS-2025-123456

  -- Partner who will process this
  partner_id UUID NOT NULL REFERENCES renewal_partners(id),

  -- Customer info
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,

  -- Vehicle info
  license_plate TEXT NOT NULL,
  license_state TEXT NOT NULL DEFAULT 'IL',
  vin TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,

  -- Address (for proof of residence)
  street_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'IL',
  zip_code TEXT NOT NULL,
  ward INTEGER,

  -- Documents uploaded
  documents JSONB DEFAULT '[]'::jsonb,
  -- [
  --   {
  --     "type": "drivers_license_front",
  --     "url": "https://...",
  --     "filename": "license.jpg",
  --     "uploaded_at": "2025-01-15T10:00:00Z",
  --     "verified": true,
  --     "verified_at": "2025-01-15T10:05:00Z",
  --     "verified_by": "admin_user_id"
  --   },
  --   {
  --     "type": "drivers_license_back",
  --     ...
  --   },
  --   {
  --     "type": "proof_of_residence",
  --     "subtype": "utility_bill",
  --     ...
  --   }
  -- ]

  -- Payment
  sticker_type TEXT NOT NULL, -- 'passenger', 'large', 'small', 'motorcycle'
  sticker_price DECIMAL(10,2) NOT NULL,
  service_fee DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,

  stripe_payment_intent_id TEXT UNIQUE,
  stripe_transfer_id TEXT, -- Transfer to partner's connected account
  payment_status TEXT DEFAULT 'pending', -- pending, paid, failed, refunded
  paid_at TIMESTAMPTZ,

  -- Processing status
  status TEXT DEFAULT 'submitted',
  -- submitted, documents_verified, payment_received, sent_to_city,
  -- sticker_ready, completed, rejected, cancelled

  -- Integration with city/partner portal
  pushed_to_portal BOOLEAN DEFAULT false,
  pushed_to_portal_at TIMESTAMPTZ,
  portal_confirmation_number TEXT,
  portal_error TEXT,

  -- Sticker details (once processed)
  sticker_number TEXT,
  sticker_issued_at TIMESTAMPTZ,
  sticker_expires_at TIMESTAMPTZ,

  -- Pickup/delivery
  fulfillment_method TEXT DEFAULT 'mail', -- mail, pickup
  pickup_location TEXT,
  shipped_at TIMESTAMPTZ,
  tracking_number TEXT,
  delivered_at TIMESTAMPTZ,

  -- Notifications sent
  notifications_sent JSONB DEFAULT '[]'::jsonb,
  -- [
  --   {"type": "confirmation", "sent_at": "2025-01-15T10:00:00Z", "channel": "email"},
  --   {"type": "payment_received", "sent_at": "...", "channel": "sms"},
  --   {"type": "ready_for_pickup", "sent_at": "...", "channel": "email+sms"}
  -- ]

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Notes
  customer_notes TEXT,
  internal_notes TEXT
);

CREATE INDEX idx_renewal_orders_partner ON renewal_orders(partner_id);
CREATE INDEX idx_renewal_orders_status ON renewal_orders(status);
CREATE INDEX idx_renewal_orders_payment_status ON renewal_orders(payment_status);
CREATE INDEX idx_renewal_orders_order_number ON renewal_orders(order_number);
CREATE INDEX idx_renewal_orders_license_plate ON renewal_orders(license_plate);
CREATE INDEX idx_renewal_orders_created ON renewal_orders(created_at DESC);

-- Document verification queue (for manual review if needed)
CREATE TABLE IF NOT EXISTS renewal_document_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES renewal_orders(id) ON DELETE CASCADE,

  document_type TEXT NOT NULL,
  document_url TEXT NOT NULL,

  -- Review
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Auto-verification (OCR/AI)
  auto_verified BOOLEAN DEFAULT false,
  auto_verification_confidence DECIMAL(5,2), -- 0-100%
  extracted_data JSONB, -- OCR extracted info

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_reviews_order ON renewal_document_reviews(order_id);
CREATE INDEX idx_document_reviews_status ON renewal_document_reviews(status);

-- Activity log for audit compliance
CREATE TABLE IF NOT EXISTS renewal_order_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES renewal_orders(id) ON DELETE CASCADE,

  activity_type TEXT NOT NULL,
  -- 'order_created', 'document_uploaded', 'payment_received',
  -- 'sent_to_portal', 'status_changed', 'notification_sent'

  description TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,

  performed_by UUID REFERENCES auth.users(id), -- NULL if system action
  performed_by_type TEXT DEFAULT 'system', -- system, customer, admin, partner

  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_log_order ON renewal_order_activity_log(order_id);
CREATE INDEX idx_activity_log_created ON renewal_order_activity_log(created_at DESC);

-- Partner dashboard stats (materialized for performance)
CREATE TABLE IF NOT EXISTS renewal_partner_stats (
  partner_id UUID PRIMARY KEY REFERENCES renewal_partners(id) ON DELETE CASCADE,

  -- Today's stats
  orders_today INTEGER DEFAULT 0,
  revenue_today DECIMAL(10,2) DEFAULT 0,

  -- This week
  orders_this_week INTEGER DEFAULT 0,
  revenue_this_week DECIMAL(10,2) DEFAULT 0,

  -- This month
  orders_this_month INTEGER DEFAULT 0,
  revenue_this_month DECIMAL(10,2) DEFAULT 0,

  -- All time
  total_orders INTEGER DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,

  -- Status counts
  pending_review_count INTEGER DEFAULT 0,
  ready_for_pickup_count INTEGER DEFAULT 0,
  completed_today_count INTEGER DEFAULT 0,

  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Comments
COMMENT ON TABLE renewal_partners IS 'Partners (remitters, dealerships) who process city sticker renewals';
COMMENT ON TABLE renewal_orders IS 'Digital city sticker renewal orders from customers';
COMMENT ON TABLE renewal_document_reviews IS 'Document verification queue for uploaded IDs and proof of residence';
COMMENT ON TABLE renewal_order_activity_log IS 'Audit log of all actions on renewal orders';
COMMENT ON TABLE renewal_partner_stats IS 'Cached statistics for partner dashboards';

-- Row Level Security
ALTER TABLE renewal_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_document_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_order_activity_log ENABLE ROW LEVEL SECURITY;

-- Partners can only see their own data
CREATE POLICY partner_view_own_data ON renewal_partners
  FOR SELECT USING (id IN (
    SELECT partner_id FROM partner_users WHERE user_id = auth.uid()
  ));

CREATE POLICY partner_view_own_orders ON renewal_orders
  FOR SELECT USING (partner_id IN (
    SELECT partner_id FROM partner_users WHERE user_id = auth.uid()
  ));

-- Admins can see everything
CREATE POLICY admin_view_all_partners ON renewal_partners
  FOR ALL USING (
    EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
  );

CREATE POLICY admin_view_all_orders ON renewal_orders
  FOR ALL USING (
    EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
  );
