-- Webhook Health Check Results Table
-- Stores results of automated health checks for monitoring

CREATE TABLE IF NOT EXISTS webhook_health_checks (
  id SERIAL PRIMARY KEY,
  webhook_name TEXT NOT NULL,
  check_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  overall_status TEXT NOT NULL, -- 'healthy' or 'unhealthy'
  check_results JSONB NOT NULL, -- Full health check results
  alert_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_webhook_health_checks_webhook_name
  ON webhook_health_checks(webhook_name, check_time DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_health_checks_status
  ON webhook_health_checks(overall_status, check_time DESC);

-- Add comment
COMMENT ON TABLE webhook_health_checks IS 'Automated health check results for webhooks - daily monitoring';

-- Grant access
GRANT SELECT, INSERT ON webhook_health_checks TO authenticated;
GRANT SELECT, INSERT ON webhook_health_checks TO anon;
