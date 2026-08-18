BEGIN;

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER;

ALTER TABLE public.medicine_sales
  ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER;

ALTER TABLE public.treatments
  DROP CONSTRAINT IF EXISTS treatments_loyalty_points_earned_check;
ALTER TABLE public.treatments
  ADD CONSTRAINT treatments_loyalty_points_earned_check
  CHECK (loyalty_points_earned IS NULL OR loyalty_points_earned >= 0);

ALTER TABLE public.medicine_sales
  DROP CONSTRAINT IF EXISTS medicine_sales_loyalty_points_earned_check;
ALTER TABLE public.medicine_sales
  ADD CONSTRAINT medicine_sales_loyalty_points_earned_check
  CHECK (loyalty_points_earned IS NULL OR loyalty_points_earned >= 0);

ALTER TABLE public.loyalty_transactions
  DROP CONSTRAINT IF EXISTS loyalty_transactions_type_check;
ALTER TABLE public.loyalty_transactions
  ADD CONSTRAINT loyalty_transactions_type_check
  CHECK (type IN ('EARNED', 'REDEEMED', 'EXPIRED', 'REVERSED'));

CREATE OR REPLACE FUNCTION public.capture_clinical_loyalty_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_type TEXT;
  v_amount NUMERIC;
  v_points_per_unit NUMERIC := 0.001;
  v_min_amount NUMERIC := 0;
BEGIN
  IF NEW.loyalty_points_earned IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'treatments' THEN
    v_event_type := 'TREATMENT';
    v_amount := COALESCE(NEW.cost, 0);
  ELSIF TG_TABLE_NAME = 'medicine_sales' THEN
    v_event_type := 'PURCHASE';
    v_amount := COALESCE(NEW.total_price, 0);
  ELSE
    RAISE EXCEPTION 'Unsupported loyalty source table: %', TG_TABLE_NAME;
  END IF;

  SELECT COALESCE(rule.points_per_unit, 0.001), COALESCE(rule.min_amount, 0)
  INTO v_points_per_unit, v_min_amount
  FROM public.loyalty_rules AS rule
  WHERE rule.location_id = NEW.location_id
    AND rule.event_type = v_event_type
    AND rule.active = TRUE
  ORDER BY rule.name, rule.id
  LIMIT 1
  FOR SHARE;

  v_points_per_unit := COALESCE(v_points_per_unit, 0.001);
  v_min_amount := COALESCE(v_min_amount, 0);

  NEW.loyalty_points_earned := CASE
    WHEN v_amount >= v_min_amount THEN FLOOR(v_amount * v_points_per_unit)
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_clinical_loyalty_points() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_capture_treatment_loyalty_points ON public.treatments;
CREATE TRIGGER trg_capture_treatment_loyalty_points
BEFORE INSERT ON public.treatments
FOR EACH ROW EXECUTE FUNCTION public.capture_clinical_loyalty_points();

DROP TRIGGER IF EXISTS trg_capture_medicine_sale_loyalty_points ON public.medicine_sales;
CREATE TRIGGER trg_capture_medicine_sale_loyalty_points
BEFORE INSERT ON public.medicine_sales
FOR EACH ROW EXECUTE FUNCTION public.capture_clinical_loyalty_points();

CREATE OR REPLACE FUNCTION public.undo_treatment_atomic(p_treatment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_treatment public.treatments%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_stock RECORD;
  v_sale_ids JSONB := '[]'::JSONB;
  v_restocked JSONB := '[]'::JSONB;
  v_medicine_total NUMERIC(12,2) := 0;
  v_total_reversal NUMERIC(12,2) := 0;
  v_medicine_points INTEGER := 0;
  v_total_points INTEGER := 0;
  v_new_balance NUMERIC(12,2);
  v_new_points INTEGER;
  v_new_stock NUMERIC(12,2);
  v_reversal public.loyalty_transactions%ROWTYPE;
BEGIN
  IF p_treatment_id IS NULL THEN
    RAISE EXCEPTION 'Treatment ID is required';
  END IF;

  SELECT * INTO v_treatment
  FROM public.treatments
  WHERE id = p_treatment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Treatment not found';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients
  WHERE id = v_treatment.patient_id
    AND location_id = v_treatment.location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Treatment patient was not found in this location';
  END IF;

  SELECT * INTO v_treatment
  FROM public.treatments
  WHERE id = p_treatment_id
    AND patient_id = v_patient.id
    AND location_id = v_patient.location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Treatment changed while undo was starting; retry';
  END IF;

  IF v_treatment.loyalty_points_earned IS NULL THEN
    RAISE EXCEPTION 'This legacy treatment has no exact loyalty snapshot and cannot be safely undone automatically';
  END IF;

  PERFORM 1
  FROM public.medicine_sales AS sale
  WHERE sale.treatment_id = p_treatment_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.medicine_sales AS sale
    WHERE sale.treatment_id = p_treatment_id
      AND sale.loyalty_points_earned IS NULL
  ) THEN
    RAISE EXCEPTION 'A linked legacy medicine sale has no exact loyalty snapshot and cannot be safely undone automatically';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS payment
    WHERE payment.patient_id = v_patient.id
      AND (
        p_treatment_id = ANY(COALESCE(payment.treatment_ids, '{}'::UUID[]))
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(payment.receipt_snapshot -> 'treatments') = 'array'
                THEN payment.receipt_snapshot -> 'treatments'
              ELSE '[]'::JSONB
            END
          ) AS item
          WHERE item ->> 'id' = p_treatment_id::TEXT
        )
        OR EXISTS (
          SELECT 1
          FROM public.medicine_sales AS sale
          JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(payment.receipt_snapshot -> 'medicines') = 'array'
                THEN payment.receipt_snapshot -> 'medicines'
              ELSE '[]'::JSONB
            END
          ) AS item ON item ->> 'id' = sale.id::TEXT
          WHERE sale.treatment_id = p_treatment_id
        )
      )
  ) OR EXISTS (
    SELECT 1 FROM public.doctor_commission_entries
    WHERE treatment_id = p_treatment_id
  ) THEN
    RAISE EXCEPTION 'Paid or reconciled treatments cannot be undone; correct the payment first';
  END IF;

  SELECT
    COALESCE(SUM(sale.total_price), 0),
    COALESCE(SUM(sale.loyalty_points_earned), 0),
    COALESCE(jsonb_agg(to_jsonb(sale.id) ORDER BY sale.id), '[]'::JSONB)
  INTO v_medicine_total, v_medicine_points, v_sale_ids
  FROM public.medicine_sales AS sale
  WHERE sale.treatment_id = p_treatment_id;

  v_total_reversal := ROUND(COALESCE(v_treatment.cost, 0) + v_medicine_total, 2);
  v_total_points := COALESCE(v_treatment.loyalty_points_earned, 0) + v_medicine_points;

  IF COALESCE(v_patient.balance, 0) + 0.005 < v_total_reversal THEN
    RAISE EXCEPTION 'Patient balance is lower than this treatment total; correct linked financial activity before undo';
  END IF;
  IF COALESCE(v_patient.loyalty_points, 0) < v_total_points THEN
    RAISE EXCEPTION 'Patient has already used loyalty points earned by this treatment; correct loyalty activity before undo';
  END IF;

  FOR v_stock IN
    SELECT sale.medicine_id, SUM(sale.quantity) AS quantity
    FROM public.medicine_sales AS sale
    WHERE sale.treatment_id = p_treatment_id
    GROUP BY sale.medicine_id
    ORDER BY sale.medicine_id
  LOOP
    PERFORM 1
    FROM public.medicines AS medicine
    WHERE medicine.id = v_stock.medicine_id
      AND medicine.location_id = v_treatment.location_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked medicine was not found in the treatment location';
    END IF;

    UPDATE public.medicines
    SET stock = COALESCE(stock, 0) + v_stock.quantity,
        updated_at = NOW()
    WHERE id = v_stock.medicine_id
    RETURNING stock INTO v_new_stock;

    v_restocked := v_restocked || jsonb_build_array(jsonb_build_object(
      'medicine_id', v_stock.medicine_id,
      'quantity_added', v_stock.quantity,
      'new_stock', v_new_stock
    ));
  END LOOP;

  UPDATE public.patients
  SET balance = ROUND((COALESCE(balance, 0) - v_total_reversal)::NUMERIC, 2),
      loyalty_points = COALESCE(loyalty_points, 0) - v_total_points
  WHERE id = v_patient.id
  RETURNING balance, loyalty_points INTO v_new_balance, v_new_points;

  IF v_total_points > 0 THEN
    INSERT INTO public.loyalty_transactions (
      patient_id, location_id, points, type, description
    ) VALUES (
      v_patient.id,
      v_treatment.location_id,
      -v_total_points,
      'REVERSED',
      FORMAT('Reversed after undoing treatment: %s', COALESCE(v_treatment.description, 'Treatment'))
    )
    RETURNING * INTO v_reversal;
  END IF;

  DELETE FROM public.medicine_sales WHERE treatment_id = p_treatment_id;
  DELETE FROM public.treatments WHERE id = p_treatment_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'treatment_id', p_treatment_id,
    'patient_id', v_patient.id,
    'new_balance', v_new_balance,
    'new_points', v_new_points,
    'reversed_points', v_total_points,
    'reversed_medicine_sale_ids', v_sale_ids,
    'restocked_medicines', v_restocked,
    'loyalty_reversal', CASE WHEN v_total_points > 0 THEN to_jsonb(v_reversal) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_treatment_atomic(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_treatment_atomic(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
