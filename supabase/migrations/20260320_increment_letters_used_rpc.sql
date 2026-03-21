-- Atomic increment for letters_used_this_period to prevent race conditions
-- Used by autopilot-mail-letters.ts
CREATE OR REPLACE FUNCTION increment_letters_used(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count integer;
  v_letters_included integer;
BEGIN
  UPDATE autopilot_subscriptions
  SET letters_used_this_period = COALESCE(letters_used_this_period, 0) + 1
  WHERE user_id = p_user_id
  RETURNING letters_used_this_period, letters_included
  INTO v_new_count, v_letters_included;

  IF NOT FOUND THEN
    RETURN json_build_object('new_count', 0, 'letters_included', 1);
  END IF;

  RETURN json_build_object('new_count', v_new_count, 'letters_included', COALESCE(v_letters_included, 1));
END;
$$;
