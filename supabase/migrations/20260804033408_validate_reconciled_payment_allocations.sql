BEGIN;

CREATE OR REPLACE FUNCTION public.validate_reconciled_payment_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_treatment_total NUMERIC := 0;
  v_medicine_total NUMERIC := 0;
  v_service_fee NUMERIC := 0;
BEGIN
  -- Old clients do not send this marker and remain compatible during rollout.
  IF COALESCE((NEW.receipt_snapshot ->> 'allocationReconciled')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.receipt_snapshot -> 'treatments') <> 'array'
     OR jsonb_typeof(NEW.receipt_snapshot -> 'medicines') <> 'array' THEN
    RAISE EXCEPTION 'Reconciled receipt snapshot requires treatment and medicine arrays';
  END IF;

  SELECT COALESCE(SUM(GREATEST((item ->> 'finalCost')::NUMERIC, 0)), 0)
  INTO v_treatment_total
  FROM jsonb_array_elements(NEW.receipt_snapshot -> 'treatments') AS item;

  SELECT COALESCE(SUM(GREATEST((item ->> 'totalPrice')::NUMERIC, 0)), 0)
  INTO v_medicine_total
  FROM jsonb_array_elements(NEW.receipt_snapshot -> 'medicines') AS item;

  v_service_fee := GREATEST(
    COALESCE(NULLIF(NEW.receipt_snapshot #>> '{payment,serviceFeeAmount}', '')::NUMERIC, 0),
    0
  );

  IF NEW.amount > v_treatment_total + v_medicine_total + v_service_fee + 0.005 THEN
    RAISE EXCEPTION 'Payment amount exceeds reconciled receipt allocation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(NEW.treatment_ids, ARRAY[]::UUID[])) AS linked_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.receipt_snapshot -> 'treatments') AS item
      WHERE item ->> 'id' = linked_id::TEXT
    )
  ) THEN
    RAISE EXCEPTION 'Linked treatment is missing from reconciled receipt snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(NEW.treatment_ids, ARRAY[]::UUID[])) AS linked_id
    LEFT JOIN public.treatments treatment ON treatment.id = linked_id
    WHERE treatment.id IS NULL OR treatment.patient_id <> NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'Linked treatment does not belong to payment patient';
  END IF;

  -- Defaults are available before BEFORE triggers, so replace the UI placeholder atomically.
  NEW.receipt_snapshot := jsonb_set(
    NEW.receipt_snapshot,
    '{receiptNumber}',
    to_jsonb(NEW.receipt_number::TEXT),
    TRUE
  );

  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Reconciled receipt snapshot contains an invalid amount';
END;
$$;

REVOKE ALL ON FUNCTION public.validate_reconciled_payment_allocation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_reconciled_payment_allocation ON public.payments;
CREATE TRIGGER trg_validate_reconciled_payment_allocation
BEFORE INSERT OR UPDATE OF amount, treatment_ids, receipt_snapshot
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.validate_reconciled_payment_allocation();

COMMIT;
