-- Add native_meta JSONB column to parking_diagnostics so we can persist the
-- iOS BackgroundLocationModule's detection context alongside each check-parking
-- call. Lets us see, per event, which capture path produced the GPS coords
-- (stop_start vs last_driving vs current_fallback), how long the driving phase
-- lasted, how far the user had walked from the saved spot by check time, and
-- the delay between native capture and server arrival.
--
-- Motivation: Randy's 2026-04-16 Wolcott→Lawrence misdetect could not be
-- diagnosed because gps_source was always null and we had no visibility into
-- whether the anchor held.

ALTER TABLE public.parking_diagnostics
  ADD COLUMN IF NOT EXISTS native_meta JSONB;

COMMENT ON COLUMN public.parking_diagnostics.native_meta IS
  'iOS native detection context: {locationSource, detectionSource, drivingDurationSec, driftFromParkingMeters, nativeTimestampMs, captureToServerDelaySec}';
