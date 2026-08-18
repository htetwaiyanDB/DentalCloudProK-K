BEGIN;

CREATE OR REPLACE FUNCTION public.undo_medicine_sale_atomic(p_medicine_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.medicine_sales%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_medicine public.medicines%ROWTYPE;
  v_new_balance NUMERIC(12,2);
  v_new_points INTEGER;
  v_new_stock NUMERIC(12,2);
  v_reversed_points INTEGER;
  v_reversal public.loyalty_transactions%ROWTYPE;
BEGIN
  IF p_medicine_sale_id IS NULL THEN
    RAISE EXCEPTION 'Medicine sale ID is required';
  END IF;

  SELECT * INTO v_sale
  FROM public.medicine_sales
  WHERE id = p_medicine_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine record not found';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients
  WHERE id = v_sale.patient_id
    AND location_id = v_sale.location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine record patient was not found in this location';
  END IF;

  SELECT * INTO v_sale
  FROM public.medicine_sales
  WHERE id = p_medicine_sale_id
    AND patient_id = v_patient.id
    AND location_id = v_patient.location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine record changed while undo was starting; retry';
  END IF;

  IF v_sale.loyalty_points_earned IS NULL THEN
    RAISE EXCEPTION 'This legacy medicine record has no exact loyalty snapshot and cannot be safely undone automatically';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS payment
    WHERE payment.patient_id = v_patient.id
      AND (
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(payment.receipt_snapshot -> 'medicines') = 'array'
                THEN payment.receipt_snapshot -> 'medicines'
              ELSE '[]'::JSONB
            END
          ) AS item
          WHERE item ->> 'id' = p_medicine_sale_id::TEXT
        )
        OR (
          v_sale.treatment_id IS NOT NULL
          AND (
            v_sale.treatment_id = ANY(COALESCE(payment.treatment_ids, '{}'::UUID[]))
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(payment.receipt_snapshot -> 'treatments') = 'array'
                    THEN payment.receipt_snapshot -> 'treatments'
                  ELSE '[]'::JSONB
                END
              ) AS item
              WHERE item ->> 'id' = v_sale.treatment_id::TEXT
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Paid or receipted medicine records cannot be undone; correct the payment first';
  END IF;

  IF COALESCE(v_patient.balance, 0) + 0.005 < COALESCE(v_sale.total_price, 0) THEN
    RAISE EXCEPTION 'Patient balance is lower than this medicine charge; correct linked financial activity before undo';
  END IF;

  v_reversed_points := COALESCE(v_sale.loyalty_points_earned, 0);
  IF COALESCE(v_patient.loyalty_points, 0) < v_reversed_points THEN
    RAISE EXCEPTION 'Patient has already used loyalty points earned by this medicine record; correct loyalty activity before undo';
  END IF;

  SELECT * INTO v_medicine
  FROM public.medicines
  WHERE id = v_sale.medicine_id
    AND location_id = v_sale.location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item was not found in the medicine record location';
  END IF;

  UPDATE public.medicines
  SET stock = COALESCE(stock, 0) + v_sale.quantity,
      updated_at = NOW()
  WHERE id = v_sale.medicine_id
  RETURNING stock INTO v_new_stock;

  UPDATE public.patients
  SET balance = ROUND((COALESCE(balance, 0) - COALESCE(v_sale.total_price, 0))::NUMERIC, 2),
      loyalty_points = COALESCE(loyalty_points, 0) - v_reversed_points
  WHERE id = v_patient.id
  RETURNING balance, loyalty_points INTO v_new_balance, v_new_points;

  IF v_reversed_points > 0 THEN
    INSERT INTO public.loyalty_transactions (
      patient_id, location_id, points, type, description
    ) VALUES (
      v_patient.id,
      v_sale.location_id,
      -v_reversed_points,
      'REVERSED',
      FORMAT('Reversed after undoing medicine record: %s (Qty: %s)', v_medicine.name, v_sale.quantity)
    )
    RETURNING * INTO v_reversal;
  END IF;

  DELETE FROM public.medicine_sales WHERE id = p_medicine_sale_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'medicine_sale_id', p_medicine_sale_id,
    'medicine_id', v_sale.medicine_id,
    'patient_id', v_patient.id,
    'quantity_restocked', v_sale.quantity,
    'new_stock', v_new_stock,
    'new_balance', v_new_balance,
    'new_points', v_new_points,
    'reversed_points', v_reversed_points,
    'loyalty_reversal', CASE WHEN v_reversed_points > 0 THEN to_jsonb(v_reversal) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_medicine_sale_atomic(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_medicine_sale_atomic(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;