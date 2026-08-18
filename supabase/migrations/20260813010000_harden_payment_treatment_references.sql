-- Prevent stale/deleted treatment references for both full and partial payments.
-- Existing exact-allocation reconciliation remains unchanged and marker-gated.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_payment_treatment_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_link_count INTEGER := 0;
  v_distinct_link_count INTEGER := 0;
  v_locked_count INTEGER := 0;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT linked_id)
  INTO v_link_count, v_distinct_link_count
  FROM unnest(COALESCE(NEW.treatment_ids, ARRAY[]::UUID[])) AS linked_id;

  IF v_link_count <> v_distinct_link_count THEN
    RAISE EXCEPTION 'Payment contains duplicate treatment references' USING ERRCODE = '22023';
  END IF;

  -- Lock every authoritative treatment until the payment transaction commits.
  -- Atomic treatment undo takes FOR UPDATE locks and, after waiting, rechecks
  -- payments before delete, so it cannot create a dangling treatment reference.
  SELECT COUNT(*)
  INTO v_locked_count
  FROM (
    SELECT treatment.id
    FROM public.treatments AS treatment
    WHERE treatment.id = ANY(COALESCE(NEW.treatment_ids, ARRAY[]::UUID[]))
      AND treatment.patient_id = NEW.patient_id
      AND treatment.location_id = NEW.location_id
    ORDER BY treatment.id
    FOR KEY SHARE
  ) AS locked_treatments;

  IF v_locked_count <> v_link_count THEN
    RAISE EXCEPTION 'Payment contains an invalid treatment reference' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_payment_treatment_references() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_payment_treatment_references ON public.payments;
CREATE TRIGGER trg_guard_payment_treatment_references
BEFORE INSERT OR UPDATE OF patient_id, location_id, treatment_ids
ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_treatment_references();

NOTIFY pgrst, 'reload schema';
COMMIT;
