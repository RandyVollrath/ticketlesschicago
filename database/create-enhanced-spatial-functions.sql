-- Enhanced PostGIS Spatial Functions for Mobile App
-- These functions provide location-based parking restriction lookups with timing information

-- =====================================================
-- 1. STREET CLEANING LOCATION LOOKUP (ENHANCED)
-- =====================================================
-- Returns ward, section, and next cleaning date for a GPS location
CREATE OR REPLACE FUNCTION get_street_cleaning_at_location_enhanced(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  ward TEXT,
  section TEXT,
  street_name TEXT,
  next_cleaning_date DATE,
  distance FLOAT,
  geometry_type TEXT
) AS $$
BEGIN
  -- Connect to MyStreetCleaning database to get ward/section from geometry
  -- Then find next cleaning date for that ward/section

  RETURN QUERY
  WITH nearest_zone AS (
    -- Find closest street cleaning zone using PostGIS
    SELECT
      sc.ward,
      sc.section,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
        sc.geom_simplified::geography
      ) as dist,
      'street_cleaning_zone'::TEXT as geom_type
    FROM street_cleaning_schedule sc
    WHERE sc.geom_simplified IS NOT NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
        sc.geom_simplified::geography,
        distance_meters
      )
    ORDER BY dist
    LIMIT 1
  ),
  next_cleaning AS (
    -- Get the next cleaning date for this ward/section
    SELECT
      nz.ward,
      nz.section,
      MIN(scs.cleaning_date) as next_date
    FROM nearest_zone nz
    LEFT JOIN street_cleaning_schedule scs
      ON scs.ward = nz.ward
      AND scs.section = nz.section
      AND scs.cleaning_date >= CURRENT_DATE
    GROUP BY nz.ward, nz.section
  )
  SELECT
    nc.ward::TEXT,
    nc.section::TEXT,
    ('Ward ' || nc.ward || ' Section ' || nc.section)::TEXT as street_name,
    nc.next_date as next_cleaning_date,
    nz.dist::FLOAT,
    nz.geom_type
  FROM next_cleaning nc
  JOIN nearest_zone nz ON nz.ward = nc.ward AND nz.section = nc.section;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 2. SNOW ROUTE LOCATION LOOKUP (ENHANCED)
-- =====================================================
-- Returns if location is on a snow route and current ban status
CREATE OR REPLACE FUNCTION get_snow_route_at_location_enhanced(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  street_name TEXT,
  restrict_type TEXT,
  distance FLOAT,
  is_ban_active BOOLEAN,
  ban_activation_date TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH nearest_route AS (
    SELECT
      sr.on_street::TEXT as street_name,
      sr.restrict_type::TEXT,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
        sr.geom::geography
      ) as dist
    FROM snow_routes sr
    WHERE ST_DWithin(
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      sr.geom::geography,
      distance_meters
    )
    ORDER BY dist
    LIMIT 1
  )
  SELECT
    nr.street_name,
    nr.restrict_type,
    nr.dist::FLOAT as distance,
    COALESCE(srs.is_active, false) as is_ban_active,
    srs.activation_date
  FROM nearest_route nr
  LEFT JOIN snow_route_status srs ON srs.id = 1; -- Single row table
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. PERMIT ZONE LOCATION LOOKUP (ENHANCED)
-- =====================================================
-- Returns permit zone information with address matching
CREATE OR REPLACE FUNCTION get_permit_zone_at_location_enhanced(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 50
)
RETURNS TABLE (
  zone_name TEXT,
  status TEXT,
  street_full TEXT,
  address_range TEXT,
  restricted_hours TEXT,
  distance FLOAT
) AS $$
BEGIN
  -- Note: Permit zones don't have geometry in current schema
  -- This is a placeholder that would need reverse geocoding to match address
  -- For now, return empty - will be enhanced when permit zone geometry is added

  RETURN QUERY
  SELECT
    ''::TEXT as zone_name,
    ''::TEXT as status,
    ''::TEXT as street_full,
    ''::TEXT as address_range,
    'Mon-Fri 8am-6pm'::TEXT as restricted_hours, -- Default Chicago permit hours
    0::FLOAT as distance
  LIMIT 0; -- Return no rows for now
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 4. COMPREHENSIVE PARKING CHECK
-- =====================================================
-- Single function that checks ALL restriction types at once
CREATE OR REPLACE FUNCTION check_all_parking_restrictions(
  user_lat FLOAT,
  user_lng FLOAT
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  sc_data RECORD;
  snow_data RECORD;
  permit_data RECORD;
BEGIN
  -- Get street cleaning info
  SELECT * INTO sc_data
  FROM get_street_cleaning_at_location_enhanced(user_lat, user_lng, 30)
  LIMIT 1;

  -- Get snow route info
  SELECT * INTO snow_data
  FROM get_snow_route_at_location_enhanced(user_lat, user_lng, 30)
  LIMIT 1;

  -- Get permit zone info
  SELECT * INTO permit_data
  FROM get_permit_zone_at_location_enhanced(user_lat, user_lng, 50)
  LIMIT 1;

  -- Build JSON response
  result := json_build_object(
    'street_cleaning', json_build_object(
      'found', sc_data.ward IS NOT NULL,
      'ward', sc_data.ward,
      'section', sc_data.section,
      'next_cleaning_date', sc_data.next_cleaning_date,
      'distance_meters', sc_data.distance
    ),
    'snow_route', json_build_object(
      'found', snow_data.street_name IS NOT NULL,
      'street_name', snow_data.street_name,
      'is_ban_active', COALESCE(snow_data.is_ban_active, false),
      'ban_activation_date', snow_data.ban_activation_date,
      'distance_meters', snow_data.distance
    ),
    'permit_zone', json_build_object(
      'found', permit_data.zone_name IS NOT NULL,
      'zone_name', permit_data.zone_name,
      'restricted_hours', permit_data.restricted_hours,
      'distance_meters', permit_data.distance
    ),
    'location', json_build_object(
      'latitude', user_lat,
      'longitude', user_lng
    )
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. GRANTS
-- =====================================================
GRANT EXECUTE ON FUNCTION get_street_cleaning_at_location_enhanced TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_snow_route_at_location_enhanced TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_permit_zone_at_location_enhanced TO authenticated, anon;
GRANT EXECUTE ON FUNCTION check_all_parking_restrictions TO authenticated, anon;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
-- These functions can now be called from the mobile app API
