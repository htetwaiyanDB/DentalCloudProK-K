-- Freeze the effective doctor commission policy on each treatment.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.treatments') IS NULL
     OR to_regclass('public.doctors') IS NULL
     OR to_regclass('public.doctor_treatment_commissions') IS NULL
     OR to_regclass('public.doctor_commission_entries') IS NULL THEN
    RAISE EXCEPTION 'Install doctor commissions and the commission ledger before treatment snapshots';
  END IF;
END;
$$;

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS commission_type_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS commission_percentage_snapshot NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_per_visit_snapshot NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS commission_source_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS commission_snapshot_at TIMESTAMPTZ;

-- Existing ledger rows are the strongest available historical evidence. For an
-- unpaid legacy treatment, capture the effective setting present at migration.
WITH snapshot_values AS (
  SELECT
    treatment.id,
    CASE
      WHEN ledger.calculation_mode = 'flat_visit' THEN 'fixed'
      WHEN ledger.calculation_mode = 'percentage' THEN 'percentage'
      WHEN doctor.commission_type IN ('fixed', 'flat_visit') THEN 'fixed'
      ELSE 'percentage'
    END AS snapshot_type,
    CASE
      WHEN ledger.calculation_mode = 'percentage' THEN ledger.commission_rate
      WHEN ledger.calculation_mode = 'flat_visit' THEN 0
      WHEN doctor.commission_type IN ('fixed', 'flat_visit') THEN 0
      ELSE COALESCE(custom.commission_rate, doctor.commission_percentage, 0)
    END AS snapshot_percentage,
    CASE
      WHEN ledger.calculation_mode = 'flat_visit' THEN ledger.commission_rate
      WHEN ledger.calculation_mode = 'percentage' THEN 0
      WHEN doctor.commission_type IN ('fixed', 'flat_visit') THEN COALESCE(doctor.commission_per_visit, 0)
      ELSE 0
    END AS snapshot_per_visit,
    CASE
      WHEN ledger.payment_id IS NOT NULL THEN 'ledger_history'
      WHEN doctor.commission_type NOT IN ('fixed', 'flat_visit') AND custom.commission_rate IS NOT NULL THEN 'treatment_override'
      ELSE 'doctor_default'
    END AS snapshot_source,
    COALESCE(treatment.created_at, treatment.date::TIMESTAMP AT TIME ZONE 'UTC', NOW()) AS snapshot_at
  FROM public.treatments AS treatment
  JOIN public.doctors AS doctor ON doctor.id = treatment.doctor_id
  LEFT JOIN LATERAL (
    SELECT entry.payment_id, entry.calculation_mode, entry.commission_rate
    FROM public.doctor_commission_entries AS entry
    WHERE entry.treatment_id = treatment.id
    ORDER BY entry.payment_date, entry.created_at, entry.id
    LIMIT 1
  ) AS ledger ON TRUE
  LEFT JOIN public.doctor_treatment_commissions AS custom
    ON custom.doctor_id = treatment.doctor_id
   AND custom.treatment_id = treatment.treatment_type_id
)
UPDATE public.treatments AS treatment
SET
  commission_type_snapshot = snapshot.snapshot_type,
  commission_percentage_snapshot = snapshot.snapshot_percentage,
  commission_per_visit_snapshot = snapshot.snapshot_per_visit,
  commission_source_snapshot = snapshot.snapshot_source,
  commission_snapshot_at = snapshot.snapshot_at
FROM snapshot_values AS snapshot
WHERE treatment.id = snapshot.id
  AND treatment.commission_type_snapshot IS NULL;

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
  -- Commission snapshots are immutable unless the treatment's doctor or
  -- treatment type is deliberately reassigned.
  IF TG_OP = 'UPDATE'
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.treatment_type_id IS NOT DISTINCT FROM OLD.treatment_type_id THEN
    NEW.commission_type_snapshot := OLD.commission_type_snapshot;
    NEW.commission_percentage_snapshot := OLD.commission_percentage_snapshot;
    NEW.commission_per_visit_snapshot := OLD.commission_per_visit_snapshot;
    NEW.commission_source_snapshot := OLD.commission_source_snapshot;
    NEW.commission_snapshot_at := OLD.commission_snapshot_at;
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

  SELECT
    CASE WHEN doctor.commission_type IN ('fixed', 'flat_visit') THEN 'fixed' ELSE 'percentage' END,
    COALESCE(doctor.commission_percentage, 0),
    COALESCE(doctor.commission_per_visit, 0)
  INTO v_type, v_default_percentage, v_per_visit
  FROM public.doctors AS doctor
  WHERE doctor.id = NEW.doctor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Treatment doctor not found'; END IF;

  IF v_type = 'percentage' AND NEW.treatment_type_id IS NOT NULL THEN
    SELECT custom.commission_rate
    INTO v_custom_percentage
    FROM public.doctor_treatment_commissions AS custom
    WHERE custom.doctor_id = NEW.doctor_id
      AND custom.treatment_id = NEW.treatment_type_id;
  END IF;

  NEW.commission_type_snapshot := v_type;
  NEW.commission_percentage_snapshot := CASE
    WHEN v_type = 'percentage' THEN COALESCE(v_custom_percentage, v_default_percentage, 0)
    ELSE 0
  END;
  NEW.commission_per_visit_snapshot := CASE
    WHEN v_type = 'fixed' THEN COALESCE(v_per_visit, 0)
    ELSE 0
  END;
  NEW.commission_source_snapshot := CASE
    WHEN v_type = 'percentage' AND v_custom_percentage IS NOT NULL THEN 'treatment_override'
    ELSE 'doctor_default'
  END;
  NEW.commission_snapshot_at := NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_treatment_commission_snapshot ON public.treatments;
CREATE TRIGGER trg_capture_treatment_commission_snapshot
BEFORE INSERT OR UPDATE ON public.treatments
FOR EACH ROW
EXECUTE FUNCTION public.capture_treatment_commission_snapshot();

ALTER TABLE public.treatments
  DROP CONSTRAINT IF EXISTS treatments_commission_snapshot_check;

ALTER TABLE public.treatments
  ADD CONSTRAINT treatments_commission_snapshot_check CHECK (
    (
      doctor_id IS NULL
      AND commission_type_snapshot IS NULL
      AND commission_percentage_snapshot IS NULL
      AND commission_per_visit_snapshot IS NULL
      AND commission_source_snapshot IS NULL
      AND commission_snapshot_at IS NULL
    )
    OR
    (
      doctor_id IS NOT NULL
      AND commission_type_snapshot IN ('percentage', 'fixed')
      AND commission_percentage_snapshot IS NOT NULL
      AND commission_percentage_snapshot BETWEEN 0 AND 100
      AND commission_per_visit_snapshot IS NOT NULL
      AND commission_per_visit_snapshot >= 0
      AND commission_source_snapshot IS NOT NULL
      AND commission_source_snapshot IN ('doctor_default', 'treatment_override', 'ledger_history')
      AND commission_snapshot_at IS NOT NULL
      AND (
        (commission_type_snapshot = 'percentage' AND commission_per_visit_snapshot = 0)
        OR
        (commission_type_snapshot = 'fixed' AND commission_percentage_snapshot = 0)
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_treatments_commission_snapshot
  ON public.treatments(doctor_id, commission_type_snapshot, commission_snapshot_at);

COMMIT;

NOTIFY pgrst, 'reload schema';
