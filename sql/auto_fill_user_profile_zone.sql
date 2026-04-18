-- Auto-populate home_address_ward + home_address_section whenever a row's
-- home_address_lat/lng changes (or ward/section are null). This is the only
-- way to guarantee correctness across the 40+ files that write user_profiles,
-- including client-side upserts on settings.tsx / start.tsx / get-started.tsx
-- that bypass server APIs.
--
-- Runs as a BEFORE INSERT/UPDATE trigger. PostGIS lookup is a single indexed
-- polygon hit — cheap enough to run on every user_profiles save.

CREATE OR REPLACE FUNCTION public.auto_fill_user_profile_zone()
RETURNS trigger AS $$
DECLARE
  z record;
BEGIN
  IF NEW.home_address_lat IS NULL OR NEW.home_address_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip when nothing address-shaped changed and ward/section already set.
  IF TG_OP = 'UPDATE'
    AND NEW.home_address_lat IS NOT DISTINCT FROM OLD.home_address_lat
    AND NEW.home_address_lng IS NOT DISTINCT FROM OLD.home_address_lng
    AND NEW.street_address IS NOT DISTINCT FROM OLD.street_address
    AND NEW.home_address_full IS NOT DISTINCT FROM OLD.home_address_full
    AND NEW.home_address_ward IS NOT NULL
    AND NEW.home_address_section IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT fs.ward, fs.section INTO z
  FROM public.find_section_for_point(NEW.home_address_lng::numeric, NEW.home_address_lat::numeric) fs
  LIMIT 1;

  IF FOUND THEN
    NEW.home_address_ward := z.ward;
    NEW.home_address_section := z.section;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_fill_user_profile_zone_trigger ON public.user_profiles;
CREATE TRIGGER auto_fill_user_profile_zone_trigger
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_fill_user_profile_zone();
