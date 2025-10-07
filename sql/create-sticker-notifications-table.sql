-- Create table to track sticker purchase notifications
CREATE TABLE IF NOT EXISTS sticker_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sticker_type TEXT NOT NULL CHECK (sticker_type IN ('city_sticker', 'license_plate')),
  license_plate TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  sent_by TEXT, -- admin email who sent it
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sticker_notifications_user_id ON sticker_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_sticker_notifications_user_type ON sticker_notifications(user_id, sticker_type);

-- Enable RLS
ALTER TABLE sticker_notifications ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role has full access" ON sticker_notifications
  FOR ALL USING (auth.role() = 'service_role');

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications" ON sticker_notifications
  FOR SELECT USING (auth.uid() = user_id);
