-- Add lat/lng columns to Boston street sweeping table for proximity filtering

ALTER TABLE public.boston_street_sweeping
ADD COLUMN IF NOT EXISTS segment_lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS segment_lng DOUBLE PRECISION;

-- Create index for spatial queries
CREATE INDEX IF NOT EXISTS idx_boston_street_sweeping_location
ON public.boston_street_sweeping(segment_lat, segment_lng);

-- Add comment
COMMENT ON COLUMN public.boston_street_sweeping.segment_lat IS 'Latitude of street segment midpoint (geocoded)';
COMMENT ON COLUMN public.boston_street_sweeping.segment_lng IS 'Longitude of street segment midpoint (geocoded)';
