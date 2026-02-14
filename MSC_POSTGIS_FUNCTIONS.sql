-- =====================================================
-- MyStreetCleaning (MSC) PostGIS Functions
-- Extracted from MSC Supabase Database
-- =====================================================
-- Date: February 4, 2026
-- Purpose: Reference for recreating these functions in target database
-- =====================================================

-- Enable PostGIS extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- =====================================================
-- FUNCTION 1: find_section_for_point
-- =====================================================
-- Purpose: Find the street cleaning ward/section for a given lat/lon point
-- Returns: ward and section if point is within a zone polygon
-- Used by: pages/api/find-section.ts
--
-- SOURCE: Found in /home/randy-vollrath/ticketless-chicago/add-street-cleaning-migration.sql
--         Lines 260-274
-- =====================================================

CREATE OR REPLACE FUNCTION public.find_section_for_point(
    lon numeric,
    lat numeric
) RETURNS TABLE (
    ward text,
    section text
) AS $$
BEGIN
    RETURN QUERY
    SELECT z.ward, z.section
    FROM public.zones z
    WHERE ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.find_section_for_point TO anon, authenticated;

COMMENT ON FUNCTION public.find_section_for_point IS
'Finds street cleaning ward and section for a given coordinate point.
Uses ST_Contains to check if point falls within zone polygon boundary.
Parameters: lon (longitude), lat (latitude)
Returns: ward (text), section (text)
Table dependency: public.zones (must have geom column with polygon geometry)';

-- =====================================================
-- FUNCTION 2: get_nearest_street_cleaning_zone
-- =====================================================
-- Purpose: Find the nearest street cleaning zone within a specified distance
-- Returns: ward, section, and distance if found within max_distance_meters
-- Used by: lib/street-cleaning-schedule-matcher.ts (called with max_distance_meters: 50)
--
-- SOURCE: Inferred from St. Louis implementation in
--         proof-of-concept/st-louis/sql/001-create-stl-tables.sql
--         Adapted for Chicago's zones table structure
--
-- NOTE: This function was NOT found in local SQL files, but is actively used
--       in the codebase. The implementation below is reconstructed based on:
--       1. St. Louis version (get_nearest_stl_cleaning_zone)
--       2. Chicago zones table schema
--       3. TypeScript usage pattern in street-cleaning-schedule-matcher.ts
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_nearest_street_cleaning_zone(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION,
    max_distance_meters INTEGER DEFAULT 50
) RETURNS TABLE (
    ward TEXT,
    section TEXT,
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        z.ward,
        z.section,
        ST_Distance(
            ST_Transform(z.geom::geometry, 3857),  -- Transform to Web Mercator for meter-based distance
            ST_Transform(ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geometry, 3857)
        ) as distance_meters
    FROM public.zones z
    WHERE ST_DWithin(
        ST_Transform(z.geom::geometry, 3857),
        ST_Transform(ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geometry, 3857),
        max_distance_meters
    )
    ORDER BY distance_meters ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_nearest_street_cleaning_zone TO anon, authenticated;

COMMENT ON FUNCTION public.get_nearest_street_cleaning_zone IS
'Finds the nearest street cleaning zone within max_distance_meters of a coordinate point.
Uses ST_DWithin for efficient spatial filtering and ST_Distance for ordering by proximity.
Transforms coordinates to EPSG:3857 (Web Mercator) for accurate meter-based distance calculations.
Parameters: user_lat (latitude), user_lng (longitude), max_distance_meters (default: 50)
Returns: ward (text), section (text), distance_meters (double precision)
Table dependency: public.zones (must have geom column with polygon geometry)';

-- =====================================================
-- ALTERNATIVE VERSION (using geography for simpler distance)
-- =====================================================
-- If your Supabase/PostGIS version supports geography types well,
-- you can use this simpler version that doesn't require transforms:

-- CREATE OR REPLACE FUNCTION public.get_nearest_street_cleaning_zone(
--     user_lat DOUBLE PRECISION,
--     user_lng DOUBLE PRECISION,
--     max_distance_meters INTEGER DEFAULT 50
-- ) RETURNS TABLE (
--     ward TEXT,
--     section TEXT,
--     distance_meters DOUBLE PRECISION
-- ) AS $$
-- BEGIN
--     RETURN QUERY
--     SELECT
--         z.ward,
--         z.section,
--         ST_Distance(
--             z.geom::geography,
--             ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
--         ) as distance_meters
--     FROM public.zones z
--     WHERE ST_DWithin(
--         z.geom::geography,
--         ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
--         max_distance_meters
--     )
--     ORDER BY distance_meters ASC
--     LIMIT 1;
-- END;
-- $$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- REQUIRED TABLE STRUCTURE
-- =====================================================
-- The zones table must exist with this structure:
--
-- CREATE TABLE IF NOT EXISTS public.zones (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     ward text NOT NULL,
--     section text NOT NULL,
--     geom geometry(Polygon, 4326),  -- WGS84 coordinate system
--     created_at timestamp with time zone DEFAULT now(),
--     UNIQUE(ward, section)
-- );
--
-- CREATE INDEX IF NOT EXISTS zones_geom_idx ON public.zones USING GIST(geom);
-- CREATE INDEX IF NOT EXISTS zones_ward_section_idx ON public.zones(ward, section);
-- =====================================================

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- After creating these functions, verify they work:

-- Test find_section_for_point (example coordinates in Chicago)
-- SELECT * FROM find_section_for_point(-87.6298, 41.8781);

-- Test get_nearest_street_cleaning_zone
-- SELECT * FROM get_nearest_street_cleaning_zone(41.8781, -87.6298, 50);

-- Check if PostGIS is installed
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';

-- List all custom functions
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
-- AND routine_name LIKE '%section%' OR routine_name LIKE '%zone%';

-- =====================================================
-- USAGE IN CODEBASE
-- =====================================================

-- find_section_for_point is called in:
--   - pages/api/find-section.ts (line 192)
--     mscSupabase.rpc('find_section_for_point', { lon: lng, lat: lat })

-- get_nearest_street_cleaning_zone is called in:
--   - lib/street-cleaning-schedule-matcher.ts (line 77-84)
--     mscSupabase.rpc('get_nearest_street_cleaning_zone', {
--       user_lat: latitude,
--       user_lng: longitude,
--       max_distance_meters: 50
--     })

-- =====================================================
-- MIGRATION NOTES
-- =====================================================
--
-- When migrating from MSC database to main database:
-- 1. Ensure PostGIS extension is enabled
-- 2. Create or verify the zones table exists with proper schema
-- 3. Run both CREATE FUNCTION statements above
-- 4. Grant necessary permissions (already included above)
-- 5. Verify with test queries using known Chicago coordinates
-- 6. Update environment variables in code to point to main database
-- 7. Test all API endpoints that use these functions
--
-- Rollback plan:
-- - DROP FUNCTION IF EXISTS public.find_section_for_point;
-- - DROP FUNCTION IF EXISTS public.get_nearest_street_cleaning_zone;
-- - Revert environment variables to MSC database
--
-- =====================================================
