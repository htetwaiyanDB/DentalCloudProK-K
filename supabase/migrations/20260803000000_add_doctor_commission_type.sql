-- Explicit per-doctor commission method, independent of specialization.
-- Apply before deploying application code that reads commission_type.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS commission_per_visit NUMERIC(12,2);

UPDATE public.doctors
SET commission_per_visit = 0
WHERE commission_per_visit IS NULL;

ALTER TABLE public.doctors
  DROP CONSTRAINT IF EXISTS doctors_commission_per_visit_check;

ALTER TABLE public.doctors
  ADD CONSTRAINT doctors_commission_per_visit_check
  CHECK (commission_per_visit >= 0) NOT VALID;

ALTER TABLE public.doctors
  VALIDATE CONSTRAINT doctors_commission_per_visit_check;

ALTER TABLE public.doctors
  ALTER COLUMN commission_per_visit SET DEFAULT 0,
  ALTER COLUMN commission_per_visit SET NOT NULL;

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS commission_type TEXT;

UPDATE public.doctors
SET commission_type = CASE
  WHEN BTRIM(COALESCE(specialization, '')) IN ('Ortho', 'Implant', 'Surgery')
    THEN 'flat_visit'
  ELSE 'percentage'
END
WHERE commission_type IS NULL;

ALTER TABLE public.doctors
  DROP CONSTRAINT IF EXISTS doctors_commission_type_check;

ALTER TABLE public.doctors
  ADD CONSTRAINT doctors_commission_type_check
  CHECK (commission_type IN ('percentage', 'flat_visit'));

ALTER TABLE public.doctors
  ALTER COLUMN commission_type SET DEFAULT 'percentage',
  ALTER COLUMN commission_type SET NOT NULL;

DROP FUNCTION IF EXISTS public.get_applicable_commission_rate(UUID, UUID);

CREATE FUNCTION public.get_applicable_commission_rate(
  p_doctor_id UUID,
  p_treatment_id UUID
)
RETURNS DECIMAL(12,2) AS $$
DECLARE
  v_commission_type TEXT;
  v_commission_per_visit DECIMAL(12,2);
  v_custom_rate DECIMAL(5,2);
  v_default_rate DECIMAL(5,2);
BEGIN
  SELECT d.commission_type, COALESCE(d.commission_per_visit, 0), COALESCE(d.commission_percentage, 0)
  INTO v_commission_type, v_commission_per_visit, v_default_rate
  FROM public.doctors d
  WHERE d.id = p_doctor_id
  LIMIT 1;

  IF v_commission_type = 'flat_visit' THEN
    RETURN COALESCE(v_commission_per_visit, 0);
  END IF;

  SELECT dtc.commission_rate
  INTO v_custom_rate
  FROM public.doctor_treatment_commissions dtc
  WHERE dtc.doctor_id = p_doctor_id
    AND dtc.treatment_id = p_treatment_id
  LIMIT 1;

  RETURN COALESCE(v_custom_rate, v_default_rate, 0);
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;