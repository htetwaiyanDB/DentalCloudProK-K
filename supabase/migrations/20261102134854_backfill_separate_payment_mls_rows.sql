-- Give every collection its own durable MLS parent row. Historically an
-- audit_logs row was created only after staff opened MLS Costs and saved an
-- item, so old/final balance collections could have no database-backed MLS
-- record even though the payment existed.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.payments') IS NULL THEN
    RAISE EXCEPTION 'Payment MLS backfill prerequisites are missing; transaction was not applied.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_payment_mls_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doctor_id UUID;
BEGIN
  -- Keep a doctor only when all explicitly linked treatment rows belong to
  -- exactly one doctor. Unlinked legacy balance payments remain patient-linked
  -- and are allocated deterministically by the application payment ledger.
  SELECT CASE WHEN COUNT(DISTINCT treatment.doctor_id) = 1
              THEN MIN(treatment.doctor_id::TEXT)::UUID
              ELSE NULL END
  INTO v_doctor_id
  FROM public.treatments treatment
  WHERE treatment.id = ANY(COALESCE(NEW.treatment_ids, ARRAY[]::UUID[]))
    AND treatment.doctor_id IS NOT NULL;

  INSERT INTO public.audit_logs (
    source_type, source_id, location_id, patient_id, doctor_id, payment_id
  ) VALUES (
    'payment', NEW.id, NEW.location_id, NEW.patient_id, v_doctor_id, NEW.id
  )
  ON CONFLICT (source_type, source_id) DO UPDATE
  SET location_id = EXCLUDED.location_id,
      patient_id = EXCLUDED.patient_id,
      doctor_id = COALESCE(EXCLUDED.doctor_id, public.audit_logs.doctor_id),
      payment_id = EXCLUDED.payment_id,
      updated_at = NOW();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_payment_mls_audit_log() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_payment_mls_audit_log ON public.payments;
CREATE TRIGGER sync_payment_mls_audit_log
AFTER INSERT OR UPDATE OF location_id, patient_id, treatment_ids
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_payment_mls_audit_log();

-- Backfill one separate parent row for every historical collection. This is
-- idempotent and does not copy treatment-linked MLS costs onto multiple
-- payments, which would double-count historical expenses.
WITH payment_doctors AS (
  SELECT payment.id AS payment_id,
         CASE WHEN COUNT(DISTINCT treatment.doctor_id) = 1
              THEN MIN(treatment.doctor_id::TEXT)::UUID
              ELSE NULL END AS doctor_id
  FROM public.payments payment
  LEFT JOIN public.treatments treatment
    ON treatment.id = ANY(COALESCE(payment.treatment_ids, ARRAY[]::UUID[]))
   AND treatment.doctor_id IS NOT NULL
  GROUP BY payment.id
)
INSERT INTO public.audit_logs (
  source_type, source_id, location_id, patient_id, doctor_id, payment_id
)
SELECT 'payment', payment.id, payment.location_id, payment.patient_id,
       payment_doctors.doctor_id, payment.id
FROM public.payments payment
LEFT JOIN payment_doctors ON payment_doctors.payment_id = payment.id
ON CONFLICT (source_type, source_id) DO UPDATE
SET location_id = EXCLUDED.location_id,
    patient_id = EXCLUDED.patient_id,
    doctor_id = COALESCE(EXCLUDED.doctor_id, public.audit_logs.doctor_id),
    payment_id = EXCLUDED.payment_id,
    updated_at = NOW();

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Post-deploy invariant: this query must return zero rows.
SELECT payment.id
FROM public.payments payment
LEFT JOIN public.audit_logs audit
  ON audit.source_type = 'payment'
 AND audit.source_id = payment.id
 AND audit.payment_id = payment.id
WHERE audit.id IS NULL;
