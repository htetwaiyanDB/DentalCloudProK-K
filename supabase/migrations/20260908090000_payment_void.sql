-- Admin-only, auditable payment voids with atomic patient-balance reversal.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_allocations') IS NULL
     OR to_regprocedure('public.is_admin_user(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Install payment corrections and split payment allocations before payment voids';
  END IF;
END;
$$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS voided_amount NUMERIC(12,2);

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_amount_check,
  DROP CONSTRAINT IF EXISTS payments_cleared_amount_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_check CHECK (amount > 0 OR (amount = 0 AND voided_at IS NOT NULL)),
  ADD CONSTRAINT payments_cleared_amount_check CHECK (cleared_amount > 0 OR (cleared_amount = 0 AND voided_at IS NOT NULL));

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_void_fields_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_void_fields_check CHECK (
    (
      voided_at IS NULL
      AND void_reason IS NULL
      AND voided_by IS NULL
      AND voided_amount IS NULL
    )
    OR
    (
      voided_at IS NOT NULL
      AND char_length(btrim(void_reason)) BETWEEN 10 AND 500
      AND voided_by IS NOT NULL
      AND voided_amount > 0
      AND amount = 0
      AND COALESCE(cleared_amount, 0) = 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_payments_voided_at
  ON public.payments(voided_at)
  WHERE voided_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_payment_void_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Voided payments are immutable';
  END IF;

  IF (
    NEW.voided_at,
    NEW.void_reason,
    NEW.voided_by,
    NEW.voided_amount
  ) IS DISTINCT FROM (
    OLD.voided_at,
    OLD.void_reason,
    OLD.voided_by,
    OLD.voided_amount
  ) AND COALESCE(current_setting('dentalcloud.payment_void_rpc', TRUE), '') <> 'allowed' THEN
    RAISE EXCEPTION 'Use the admin payment void function';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payment_void_mutation ON public.payments;
CREATE TRIGGER trg_guard_payment_void_mutation
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_payment_void_mutation();

-- A voided payment has no live tender allocations. Keep the legacy sync trigger
-- compatible with a zeroed single-method payment.
CREATE OR REPLACE FUNCTION public.sync_legacy_payment_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.payment_method <> 'MIXED' THEN
    DELETE FROM public.payment_allocations WHERE payment_id = NEW.id;
    IF NEW.voided_at IS NULL AND COALESCE(NEW.cleared_amount, NEW.amount) > 0 THEN
      INSERT INTO public.payment_allocations (payment_id, payment_method, amount)
      VALUES (NEW.id, NEW.payment_method, COALESCE(NEW.cleared_amount, NEW.amount));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_payment_allocation ON public.payments;
CREATE TRIGGER trg_sync_legacy_payment_allocation
AFTER UPDATE OF amount, cleared_amount, payment_method, voided_at ON public.payments
FOR EACH ROW
WHEN (NEW.payment_method <> 'MIXED')
EXECUTE FUNCTION public.sync_legacy_payment_allocation();

CREATE OR REPLACE FUNCTION public.assert_payment_allocation_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_id UUID;
  v_payment public.payments%ROWTYPE;
  v_count INTEGER;
  v_total NUMERIC(12,2);
  v_only_method TEXT;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    v_payment_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_payment_id := COALESCE(NEW.payment_id, OLD.payment_id);
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = v_payment_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0), min(payment_method)
  INTO v_count, v_total, v_only_method
  FROM public.payment_allocations
  WHERE payment_id = v_payment_id;

  IF v_payment.voided_at IS NOT NULL THEN
    IF v_count <> 0 OR round(COALESCE(v_payment.cleared_amount, v_payment.amount), 2) <> 0 THEN
      RAISE EXCEPTION 'Voided payments cannot retain payment allocations or a collected amount';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_count = 0 OR round(v_total, 2) <> round(COALESCE(v_payment.cleared_amount, v_payment.amount), 2) THEN
    RAISE EXCEPTION 'Payment allocation total (%) must equal payment amount (%)', v_total, COALESCE(v_payment.cleared_amount, v_payment.amount);
  END IF;
  IF v_count = 1 AND v_payment.payment_method <> v_only_method THEN
    RAISE EXCEPTION 'Single allocation method must match payment header';
  END IF;
  IF v_count > 1 AND v_payment.payment_method <> 'MIXED' THEN
    RAISE EXCEPTION 'Multiple allocations require MIXED payment header';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_payment_record(
  p_payment_id UUID,
  p_reason TEXT,
  p_voided_by_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_patient_balance NUMERIC(12,2);
  v_reversal_amount NUMERIC(12,2);
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_balance_before NUMERIC(12,2);
BEGIN
  IF p_voided_by_user_id IS NULL OR NOT public.is_admin_user(p_voided_by_user_id) THEN
    RAISE EXCEPTION 'Only admins can void payments'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Void reason must be at least 10 characters';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Void reason cannot exceed 500 characters';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Payment is already voided'; END IF;

  v_reversal_amount := round(COALESCE(v_payment.cleared_amount, v_payment.amount, 0)::NUMERIC, 2);
  IF v_reversal_amount <= 0 THEN RAISE EXCEPTION 'Payment has no collected amount to reverse'; END IF;

  SELECT COALESCE(balance, 0)
  INTO v_patient_balance
  FROM public.patients
  WHERE id = v_payment.patient_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Payment patient not found'; END IF;

  v_balance_before := round(COALESCE(
    v_payment.balance_before,
    v_payment.remaining_balance + v_reversal_amount,
    v_reversal_amount
  )::NUMERIC, 2);

  UPDATE public.patients
  SET balance = round(v_patient_balance + v_reversal_amount, 2)
  WHERE id = v_payment.patient_id;

  -- Mixed payments do not use the legacy allocation sync trigger.
  DELETE FROM public.payment_allocations WHERE payment_id = v_payment.id;

  PERFORM set_config('dentalcloud.payment_void_rpc', 'allowed', TRUE);

  UPDATE public.payments
  SET
    amount = 0,
    cleared_amount = 0,
    remaining_balance = v_balance_before,
    payment_status = 'PARTIAL',
    voided_at = NOW(),
    void_reason = v_reason,
    voided_by = p_voided_by_user_id,
    voided_amount = v_reversal_amount,
    receipt_snapshot = CASE
      WHEN receipt_snapshot IS NULL THEN NULL
      ELSE jsonb_set(
        jsonb_set(
          jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                receipt_snapshot,
                '{payment,amountPaid}', '0'::JSONB, TRUE
              ),
              '{payment,balanceAfter}', to_jsonb(v_balance_before), TRUE
            ),
            '{payment,status}', '"PARTIAL"'::JSONB, TRUE
          ),
          '{payment,voidedAmount}', to_jsonb(v_reversal_amount), TRUE
        ),
        '{payment,voidReason}', to_jsonb(v_reason), TRUE
        ),
        '{allocationReconciled}', 'false'::JSONB, TRUE
      )
    END
  WHERE id = v_payment.id;

  RETURN v_payment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.void_payment_record(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_payment_record(UUID, TEXT, UUID) TO anon, authenticated;

COMMIT;
