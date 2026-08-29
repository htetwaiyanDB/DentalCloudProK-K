-- Follow-up for 20260829000000_add_fixed_treatment_commissions.sql.
-- Preserve NULL as “no override” for the commission method that is not active.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The initial fixed-override migration was applied before the frontend used
-- NULL for irrelevant fields. Percentage doctors cannot use fixed overrides,
-- so clear any placeholder zeroes written for them.
UPDATE public.doctor_treatment_commissions AS dtc
SET fixed_amount = NULL
FROM public.doctors AS d
WHERE d.id = dtc.doctor_id
  AND d.commission_type = 'percentage'
  AND dtc.fixed_amount = 0;

CREATE OR REPLACE FUNCTION public.configure_doctor_commission(
  p_doctor_id UUID,
  p_commission_type TEXT,
  p_commission_percentage DECIMAL(5,2),
  p_commission_per_visit DECIMAL(12,2),
  p_commissions JSONB,
  p_user_id UUID,
  p_session_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_item JSONB;
  v_treatment_id UUID;
  v_rate DECIMAL(5,2);
  v_fixed_amount DECIMAL(12,2);
  v_seen UUID[] := ARRAY[]::UUID[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users AS u
    JOIN public.staff_auth_sessions AS s ON s.user_id = u.id
    WHERE u.id = p_user_id
      AND s.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
      AND s.revoked_at IS NULL AND s.expires_at > NOW()
      AND (u.role = 'admin' OR COALESCE(u.allowed_tabs, '[]'::JSONB) ? 'doctors')
  ) THEN RAISE EXCEPTION 'A valid staff session with Doctor permission is required.'; END IF;
  IF p_commission_type NOT IN ('percentage', 'fixed') THEN RAISE EXCEPTION 'Commission method must be percentage or fixed'; END IF;
  IF p_commission_percentage IS NULL OR p_commission_percentage < 0 OR p_commission_percentage > 100 THEN RAISE EXCEPTION 'Commission percentage must be between 0 and 100'; END IF;
  IF p_commission_per_visit IS NULL OR p_commission_per_visit < 0 THEN RAISE EXCEPTION 'Commission per visit cannot be negative'; END IF;
  PERFORM 1 FROM public.doctors WHERE id = p_doctor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor not found'; END IF;
  IF p_commissions IS NULL OR jsonb_typeof(p_commissions) <> 'array' THEN RAISE EXCEPTION 'Commission list must be a JSON array'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_commissions) LOOP
    BEGIN
      v_treatment_id := (v_item->>'treatment_id')::UUID;
      v_rate := CASE WHEN p_commission_type = 'percentage' THEN (v_item->>'commission_rate')::DECIMAL(5,2) ELSE NULL END;
      v_fixed_amount := CASE WHEN p_commission_type = 'fixed' THEN (v_item->>'fixed_amount')::DECIMAL(12,2) ELSE NULL END;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Each commission requires a valid treatment_id and commission value'; END;
    IF v_treatment_id IS NULL OR (p_commission_type = 'percentage' AND (v_rate IS NULL OR v_rate < 0 OR v_rate > 100)) OR (p_commission_type = 'fixed' AND (v_fixed_amount IS NULL OR v_fixed_amount < 0)) THEN RAISE EXCEPTION 'Commission values must be non-negative and percentage rates cannot exceed 100'; END IF;
    IF v_treatment_id = ANY(v_seen) THEN RAISE EXCEPTION 'Each treatment can only have one commission'; END IF;
    v_seen := array_append(v_seen, v_treatment_id);
    IF NOT EXISTS (SELECT 1 FROM public.treatment_types WHERE id = v_treatment_id) THEN RAISE EXCEPTION 'Treatment type not found'; END IF;
  END LOOP;

  UPDATE public.doctors SET commission_type = p_commission_type, commission_percentage = p_commission_percentage, commission_per_visit = p_commission_per_visit WHERE id = p_doctor_id;
  DELETE FROM public.doctor_treatment_commissions WHERE doctor_id = p_doctor_id;
  INSERT INTO public.doctor_treatment_commissions (doctor_id, treatment_id, commission_rate, fixed_amount)
  SELECT
    p_doctor_id,
    (value->>'treatment_id')::UUID,
    CASE WHEN p_commission_type = 'percentage' THEN (value->>'commission_rate')::DECIMAL(5,2) ELSE 0 END,
    CASE WHEN p_commission_type = 'fixed' THEN (value->>'fixed_amount')::DECIMAL(12,2) ELSE NULL END
  FROM jsonb_array_elements(p_commissions);
END;
$$;

REVOKE ALL ON FUNCTION public.configure_doctor_commission(UUID, TEXT, DECIMAL, DECIMAL, JSONB, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_doctor_commission(UUID, TEXT, DECIMAL, DECIMAL, JSONB, UUID, TEXT) TO anon, authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';