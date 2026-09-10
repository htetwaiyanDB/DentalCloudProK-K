-- Permit an authorized application update to refresh a treatment's default
-- percentage snapshot after its doctor's default percentage is corrected.
-- Treatment-specific overrides and fixed commissions remain historical.
BEGIN;

CREATE OR REPLACE FUNCTION public.capture_treatment_commission_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_default_percentage NUMERIC(5,2);
  v_per_visit NUMERIC(12,2);
  v_custom_percentage NUMERIC(5,2);
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.treatment_type_id IS NOT DISTINCT FROM OLD.treatment_type_id
     AND NEW.commission_type_snapshot IS NOT DISTINCT FROM OLD.commission_type_snapshot
     AND NEW.commission_percentage_snapshot IS NOT DISTINCT FROM OLD.commission_percentage_snapshot
     AND NEW.commission_per_visit_snapshot IS NOT DISTINCT FROM OLD.commission_per_visit_snapshot
     AND NEW.commission_source_snapshot IS NOT DISTINCT FROM OLD.commission_source_snapshot
     AND NEW.commission_snapshot_at IS NOT DISTINCT FROM OLD.commission_snapshot_at THEN
    RETURN NEW;
  END IF;

  -- A doctor default-rate correction updates only the already-classified
  -- doctor_default snapshots. Do not re-resolve custom rates here: a custom
  -- override saved at the same time applies prospectively, not retroactively.
  IF TG_OP = 'UPDATE'
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.treatment_type_id IS NOT DISTINCT FROM OLD.treatment_type_id THEN
    RETURN NEW;
  END IF;

  IF NEW.doctor_id IS NULL THEN
    NEW.commission_type_snapshot := NULL;
    NEW.commission_percentage_snapshot := NULL;
    NEW.commission_per_visit_snapshot := NULL;
    NEW.commission_source_snapshot := NULL;
    NEW.commission_snapshot_at := NULL;
    RETURN NEW;
  END IF;

  SELECT CASE WHEN doctor.commission_type IN ('fixed', 'flat_visit') THEN 'fixed' ELSE 'percentage' END,
         COALESCE(doctor.commission_percentage, 0), COALESCE(doctor.commission_per_visit, 0)
  INTO v_type, v_default_percentage, v_per_visit
  FROM public.doctors AS doctor WHERE doctor.id = NEW.doctor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Treatment doctor not found'; END IF;

  IF v_type = 'percentage' AND NEW.treatment_type_id IS NOT NULL THEN
    SELECT custom.commission_rate INTO v_custom_percentage
    FROM public.doctor_treatment_commissions AS custom
    WHERE custom.doctor_id = NEW.doctor_id AND custom.treatment_id = NEW.treatment_type_id;
  END IF;

  NEW.commission_type_snapshot := v_type;
  NEW.commission_percentage_snapshot := CASE WHEN v_type = 'percentage' THEN COALESCE(v_custom_percentage, v_default_percentage, 0) ELSE 0 END;
  NEW.commission_per_visit_snapshot := CASE WHEN v_type = 'fixed' THEN v_per_visit ELSE 0 END;
  NEW.commission_source_snapshot := CASE WHEN v_type = 'percentage' AND v_custom_percentage IS NOT NULL THEN 'treatment_override' ELSE 'doctor_default' END;
  NEW.commission_snapshot_at := NOW();
  RETURN NEW;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';