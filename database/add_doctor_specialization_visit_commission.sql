-- ============================================================================
-- MIGRATION: Doctor Specialization Flat Visit Commission
-- ============================================================================
-- Purpose:
-- Add flat per-visit commission amount for Ortho/Implant/Surgery doctors.
-- Safe to run multiple times.
-- ============================================================================

BEGIN;

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS commission_per_visit DECIMAL(12,2) DEFAULT 0;

ALTER TABLE doctors
  DROP CONSTRAINT IF EXISTS doctors_commission_per_visit_check;

ALTER TABLE doctors
  ADD CONSTRAINT doctors_commission_per_visit_check
  CHECK (commission_per_visit >= 0);

UPDATE doctors
SET commission_per_visit = COALESCE(commission_per_visit, 0)
WHERE commission_per_visit IS NULL;

DROP FUNCTION IF EXISTS get_applicable_commission_rate(UUID, UUID);

CREATE OR REPLACE FUNCTION get_applicable_commission_rate(
  p_doctor_id UUID,
  p_treatment_id UUID
)
RETURNS DECIMAL(12,2) AS $$
DECLARE
  v_specialization TEXT;
  v_commission_per_visit DECIMAL(12,2);
  v_custom_rate DECIMAL(5,2);
  v_default_rate DECIMAL(5,2);
BEGIN
  SELECT d.specialization, COALESCE(d.commission_per_visit, 0), COALESCE(d.commission_percentage, 0)
  INTO v_specialization, v_commission_per_visit, v_default_rate
  FROM doctors d
  WHERE d.id = p_doctor_id
  LIMIT 1;

  IF v_specialization IN ('Ortho', 'Implant', 'Surgery') THEN
    RETURN COALESCE(v_commission_per_visit, 0);
  END IF;

  SELECT dtc.commission_rate
  INTO v_custom_rate
  FROM doctor_treatment_commissions dtc
  WHERE dtc.doctor_id = p_doctor_id
    AND dtc.treatment_id = p_treatment_id
  LIMIT 1;

  RETURN COALESCE(v_custom_rate, v_default_rate, 0);
END;
$$ LANGUAGE plpgsql;

-- Make the new column immediately visible to PostgREST/Supabase API clients.
NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT
  'migration_ok' AS status,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'doctors'
      AND column_name = 'commission_per_visit'
  ) AS has_commission_per_visit;
