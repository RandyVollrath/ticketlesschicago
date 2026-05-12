CREATE TABLE IF NOT EXISTS renewal_circuit_breakers (
  renewal_type TEXT PRIMARY KEY CHECK (renewal_type IN ('city_sticker','license_plate')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  paused_at TIMESTAMPTZ,
  paused_reason TEXT,
  manually_reset_at TIMESTAMPTZ,
  manually_reset_by TEXT,
  last_success_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO renewal_circuit_breakers (renewal_type)
  VALUES ('city_sticker'), ('license_plate')
  ON CONFLICT (renewal_type) DO NOTHING;

COMMENT ON TABLE renewal_circuit_breakers IS
  'Per-renewal-type failure tracker. After N consecutive failures the cron stops attempting that type until manually reset.';
