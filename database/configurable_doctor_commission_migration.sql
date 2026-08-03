-- ============================================================================
-- MIGRATION: Configurable doctor specialization and commission method
-- ============================================================================
-- Purpose:
-- Decouple doctor commission calculation from specialization while preserving
-- every existing doctor's current behavior. Safe to run multiple times.
-- Apply before deploying the matching frontend.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.doctor_treatment_commissions') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: run database/add_doctor_treatment_commissions.sql first.';
  END IF;
  IF to_regclass('public.staff_auth_sessions') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: run database/material_and_lab_costs_migration.sql first.';
  END IF;
END $$;

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS commission_type TEXT;

-- Preserve the legacy behavior exactly for existing rows. This update is
-- intentionally limited to NULL values so rerunning the migration never
-- overwrites a user's explicit selection.
UPDATE public.doctors
SET commission_type = CASE
  WHEN TRIM(COALESCE(specialization, '')) IN ('Ortho', 'Implant', 'Surgery') THEN 'fixed'
  ELSE 'percentage'
END
WHERE commission_type IS NULL;

ALTER TABLE public.doctors
  ALTER COLUMN commission_type DROP DEFAULT;

ALTER TABLE public.doctors
  ALTER COLUMN commission_type SET NOT NULL;

ALTER TABLE public.doctors
  DROP CONSTRAINT IF EXISTS doctors_commission_type_check;

ALTER TABLE public.doctors
  ADD CONSTRAINT doctors_commission_type_check
  CHECK (commission_type IN ('percentage', 'fixed'));

-- Rolling-deployment compatibility: old clients omit commission_type. During
-- that window, preserve their historical specialization-based behavior. New
-- clients always send an explicit value, so their choice is never overridden.
CREATE OR REPLACE FUNCTION public.set_legacy_doctor_commission_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.commission_type IS NULL THEN
    NEW.commission_type := CASE
      WHEN TRIM(COALESCE(NEW.specialization, '')) IN ('Ortho', 'Implant', 'Surgery') THEN 'fixed'
      ELSE 'percentage'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_legacy_doctor_commission_type ON public.doctors;
CREATE TRIGGER trg_set_legacy_doctor_commission_type
BEFORE INSERT ON public.doctors
FOR EACH ROW
EXECUTE FUNCTION public.set_legacy_doctor_commission_type();

-- PostgreSQL cannot change a function return type with CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.get_applicable_commission_rate(UUID, UUID);
CREATE FUNCTION public.get_applicable_commission_rate(
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
  v_default_rate DECIMAL(5,2);
BEGIN
  SELECT
    d.commission_type,
    COALESCE(d.commission_per_visit, 0),
    COALESCE(d.commission_percentage, 0)
  INTO v_commission_type, v_commission_per_visit, v_default_rate
  FROM public.doctors d
  WHERE d.id = p_doctor_id
  LIMIT 1;

  IF v_commission_type = 'fixed' THEN
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
  v_seen UUID[] := ARRAY[]::UUID[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users AS u
    JOIN public.staff_auth_sessions AS s ON s.user_id = u.id
    WHERE u.id = p_user_id
      AND s.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
      AND (u.role = 'admin' OR COALESCE(u.allowed_tabs, '[]'::JSONB) ? 'doctors')
  ) THEN
    RAISE EXCEPTION 'A valid staff session with Doctor permission is required.';
  END IF;
  IF p_commission_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Commission method must be percentage or fixed';
  END IF;
  IF p_commission_percentage IS NULL OR p_commission_percentage < 0 OR p_commission_percentage > 100 THEN
    RAISE EXCEPTION 'Commission percentage must be between 0 and 100';
  END IF;
  IF p_commission_per_visit IS NULL OR p_commission_per_visit < 0 THEN
    RAISE EXCEPTION 'Commission per visit cannot be negative';
  END IF;

  PERFORM 1 FROM public.doctors WHERE id = p_doctor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor not found';
  END IF;
  IF p_commissions IS NULL OR jsonb_typeof(p_commissions) <> 'array' THEN
    RAISE EXCEPTION 'Commission list must be a JSON array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_commissions)
  LOOP
    BEGIN
      v_treatment_id := (v_item->>'treatment_id')::UUID;
      v_rate := (v_item->>'commission_rate')::DECIMAL(5,2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Each commission requires a valid treatment_id and commission_rate';
    END;
    IF v_treatment_id IS NULL OR v_rate IS NULL OR v_rate < 0 OR v_rate > 100 THEN
      RAISE EXCEPTION 'Commission rates must be between 0 and 100';
    END IF;
    IF v_treatment_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Each treatment can only have one commission rate';
    END IF;
    v_seen := array_append(v_seen, v_treatment_id);
    IF NOT EXISTS (SELECT 1 FROM public.treatment_types WHERE id = v_treatment_id) THEN
      RAISE EXCEPTION 'Treatment type not found';
    END IF;
  END LOOP;

  UPDATE public.doctors
  SET commission_type = p_commission_type,
      commission_percentage = p_commission_percentage,
      commission_per_visit = p_commission_per_visit
  WHERE id = p_doctor_id;

  -- Fixed mode keeps percentage overrides inactive so switching back restores them.
  IF p_commission_type = 'percentage' THEN
    DELETE FROM public.doctor_treatment_commissions WHERE doctor_id = p_doctor_id;
    INSERT INTO public.doctor_treatment_commissions (doctor_id, treatment_id, commission_rate)
    SELECT p_doctor_id, (value->>'treatment_id')::UUID, (value->>'commission_rate')::DECIMAL(5,2)
    FROM jsonb_array_elements(p_commissions);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_doctor_commission(UUID, TEXT, DECIMAL, DECIMAL, JSONB, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_doctor_commission(UUID, TEXT, DECIMAL, DECIMAL, JSONB, UUID, TEXT) TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.doctor_treatment_commissions FROM anon, authenticated;
GRANT SELECT ON public.doctor_treatment_commissions TO anon, authenticated;
REVOKE INSERT, UPDATE ON public.doctors FROM anon, authenticated;
GRANT INSERT (location_id, name, email, phone, specialization, password) ON public.doctors TO anon, authenticated;
GRANT UPDATE (location_id, name, email, phone, specialization, password) ON public.doctors TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  'migration_ok' AS status,
  COUNT(*) FILTER (WHERE commission_type = 'percentage') AS percentage_doctors,
  COUNT(*) FILTER (WHERE commission_type = 'fixed') AS fixed_doctors,
  COUNT(*) FILTER (WHERE commission_type IS NULL) AS invalid_null_modes
FROM public.doctors;