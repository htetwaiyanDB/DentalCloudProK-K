-- Per-treatment fixed doctor commission overrides.
-- Apply this migration before deploying the frontend that saves fixed treatment amounts.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.doctor_treatment_commissions
  ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC(12,2);

ALTER TABLE public.doctor_treatment_commissions
  DROP CONSTRAINT IF EXISTS doctor_treatment_commissions_fixed_amount_check;

ALTER TABLE public.doctor_treatment_commissions
  ADD CONSTRAINT doctor_treatment_commissions_fixed_amount_check
  CHECK (fixed_amount IS NULL OR fixed_amount >= 0) NOT VALID;

ALTER TABLE public.doctor_treatment_commissions
  VALIDATE CONSTRAINT doctor_treatment_commissions_fixed_amount_check;

CREATE OR REPLACE FUNCTION public.get_applicable_commission_rate(
  p_doctor_id UUID,
  p_treatment_id UUID
)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_commission_type TEXT;
  v_commission_per_visit DECIMAL(12,2);
  v_custom_rate DECIMAL(5,2);
  v_custom_fixed_amount DECIMAL(12,2);
  v_default_rate DECIMAL(5,2);
BEGIN
  SELECT d.commission_type, COALESCE(d.commission_per_visit, 0), COALESCE(d.commission_percentage, 0)
  INTO v_commission_type, v_commission_per_visit, v_default_rate
  FROM public.doctors d
  WHERE d.id = p_doctor_id
  LIMIT 1;

  SELECT dtc.commission_rate, dtc.fixed_amount
  INTO v_custom_rate, v_custom_fixed_amount
  FROM public.doctor_treatment_commissions dtc
  WHERE dtc.doctor_id = p_doctor_id AND dtc.treatment_id = p_treatment_id
  LIMIT 1;

  IF v_commission_type IN ('fixed', 'flat_visit') THEN
    RETURN COALESCE(v_custom_fixed_amount, v_commission_per_visit, 0);
  END IF;

  RETURN COALESCE(v_custom_rate, v_default_rate, 0);
END;
$$;

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
      v_rate := COALESCE((v_item->>'commission_rate')::DECIMAL(5,2), 0);
      v_fixed_amount := COALESCE((v_item->>'fixed_amount')::DECIMAL(12,2), 0);
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Each commission requires a valid treatment_id and commission value'; END;
    IF v_treatment_id IS NULL OR v_rate < 0 OR v_rate > 100 OR v_fixed_amount < 0 THEN RAISE EXCEPTION 'Commission values must be non-negative and percentage rates cannot exceed 100'; END IF;
    IF v_treatment_id = ANY(v_seen) THEN RAISE EXCEPTION 'Each treatment can only have one commission'; END IF;
    v_seen := array_append(v_seen, v_treatment_id);
    IF NOT EXISTS (SELECT 1 FROM public.treatment_types WHERE id = v_treatment_id) THEN RAISE EXCEPTION 'Treatment type not found'; END IF;
  END LOOP;

  UPDATE public.doctors SET commission_type = p_commission_type, commission_percentage = p_commission_percentage, commission_per_visit = p_commission_per_visit WHERE id = p_doctor_id;
  DELETE FROM public.doctor_treatment_commissions WHERE doctor_id = p_doctor_id;
  INSERT INTO public.doctor_treatment_commissions (doctor_id, treatment_id, commission_rate, fixed_amount)
  SELECT p_doctor_id, (value->>'treatment_id')::UUID, COALESCE((value->>'commission_rate')::DECIMAL(5,2), 0), COALESCE((value->>'fixed_amount')::DECIMAL(12,2), 0)
  FROM jsonb_array_elements(p_commissions);
END;
$$;

REVOKE ALL ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_doctor_commission(UUID, TEXT, DECIMAL, DECIMAL, JSONB, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_doctor_commission(UUID, TEXT, DECIMAL, DECIMAL, JSONB, UUID, TEXT) TO anon, authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';