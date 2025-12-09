-- Performance Indexes Migration
-- Adds indexes on frequently queried columns to improve query performance
-- Run this in Supabase SQL Editor

-- Index on user_profiles.user_id (heavily filtered column)
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
ON user_profiles(user_id);

-- Index on user_profiles.email (frequent lookups)
CREATE INDEX IF NOT EXISTS idx_user_profiles_email
ON user_profiles(email);

-- Composite index on renewal dates for expiration queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_renewals
ON user_profiles(city_sticker_expiry, license_plate_expiry)
WHERE city_sticker_expiry IS NOT NULL OR license_plate_expiry IS NOT NULL;

-- Index on renewal_orders.status for filtering pending/processing orders
CREATE INDEX IF NOT EXISTS idx_renewal_orders_status
ON renewal_orders(status);

-- Index on renewal_orders.partner_id for remitter load balancing queries
CREATE INDEX IF NOT EXISTS idx_renewal_orders_partner_id
ON renewal_orders(partner_id);

-- Composite index for the common remitter order count query
CREATE INDEX IF NOT EXISTS idx_renewal_orders_partner_status
ON renewal_orders(partner_id, status);

-- Index on renewal_charges for checking existing charges
CREATE INDEX IF NOT EXISTS idx_renewal_charges_user_type_date
ON renewal_charges(user_id, charge_type, renewal_due_date);

-- Index on user_profiles.stripe_customer_id for payment lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer
ON user_profiles(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

-- Index on user_profiles for protection customers (common query filter)
CREATE INDEX IF NOT EXISTS idx_user_profiles_has_protection
ON user_profiles(has_protection)
WHERE has_protection = true;

-- Index on user_snow_ban_notifications for duplicate checking
CREATE INDEX IF NOT EXISTS idx_snow_notifications_user_event_type
ON user_snow_ban_notifications(user_id, snow_event_id, notification_type);

-- Index on snow_events for active event queries
CREATE INDEX IF NOT EXISTS idx_snow_events_active
ON snow_events(is_active, event_date DESC)
WHERE is_active = true;

-- Analyze tables to update statistics after index creation
ANALYZE user_profiles;
ANALYZE renewal_orders;
ANALYZE renewal_charges;
ANALYZE user_snow_ban_notifications;
ANALYZE snow_events;
