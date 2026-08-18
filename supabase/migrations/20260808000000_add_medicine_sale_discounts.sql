BEGIN;

ALTER TABLE public.medicine_sales
  ADD COLUMN IF NOT EXISTS standard_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_note VARCHAR(20);

UPDATE public.medicine_sales
SET standard_total = COALESCE(standard_total, total_price),
    discount_amount = GREATEST(0, COALESCE(discount_amount, 0));

ALTER TABLE public.medicine_sales
  ALTER COLUMN standard_total SET NOT NULL,
  ADD CONSTRAINT medicine_sales_standard_total_check CHECK (standard_total >= 0),
  ADD CONSTRAINT medicine_sales_discount_amount_check CHECK (discount_amount >= 0),
  ADD CONSTRAINT medicine_sales_total_consistency_check CHECK (
    total_price >= 0
    AND total_price <= standard_total
    AND ABS((standard_total - total_price) - discount_amount) <= 0.01
  ),
  ADD CONSTRAINT medicine_sales_pricing_note_check CHECK (pricing_note IS NULL OR pricing_note IN ('FOC', 'DISCOUNT')),
  ADD CONSTRAINT medicine_sales_pricing_semantics_check CHECK (
    (discount_amount = 0 AND pricing_note IS NULL)
    OR (discount_amount > 0 AND total_price = 0 AND pricing_note = 'FOC')
    OR (discount_amount > 0 AND total_price > 0 AND pricing_note = 'DISCOUNT')
  );

CREATE OR REPLACE FUNCTION public.sell_medicine_atomic(
  p_location_id UUID,
  p_patient_id UUID,
  p_medicine_id UUID,
  p_quantity NUMERIC,
  p_treatment_id UUID,
  p_sale_date DATE,
  p_final_total NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_medicine public.medicines%ROWTYPE;
  v_sale public.medicine_sales%ROWTYPE;
  v_rule public.loyalty_rules%ROWTYPE;
  v_standard_total NUMERIC(12,2);
  v_total NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_pricing_note TEXT;
  v_earned_points INTEGER := 0;
  v_new_stock NUMERIC(12,2);
  v_new_balance NUMERIC(12,2);
BEGIN
  IF p_location_id IS NULL OR p_patient_id IS NULL OR p_medicine_id IS NULL THEN
    RAISE EXCEPTION 'Location, patient, and medicine are required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  SELECT * INTO v_patient FROM public.patients
  WHERE id = p_patient_id AND location_id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient not found in this location'; END IF;

  SELECT * INTO v_medicine FROM public.medicines
  WHERE id = p_medicine_id AND location_id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicine not found in this location'; END IF;
  IF COALESCE(v_medicine.stock, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for %. Available: % %',
      v_medicine.name, COALESCE(v_medicine.stock, 0), COALESCE(v_medicine.unit, '');
  END IF;

  IF p_treatment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.treatments WHERE id = p_treatment_id
      AND patient_id = p_patient_id AND location_id = p_location_id
  ) THEN
    RAISE EXCEPTION 'Treatment not found for this patient and location';
  END IF;

  v_standard_total := ROUND(COALESCE(v_medicine.price, 0) * p_quantity, 2);
  v_total := ROUND(COALESCE(p_final_total, v_standard_total), 2);
  IF v_total < 0 OR v_total > v_standard_total THEN
    RAISE EXCEPTION 'Final medicine charge must be between 0 and the standard total of %', v_standard_total;
  END IF;
  v_discount := ROUND(v_standard_total - v_total, 2);
  v_pricing_note := CASE WHEN v_discount <= 0 THEN NULL WHEN v_total = 0 THEN 'FOC' ELSE 'DISCOUNT' END;

  SELECT * INTO v_rule FROM public.loyalty_rules
  WHERE location_id = p_location_id AND event_type = 'PURCHASE' AND active = TRUE
  ORDER BY name, id LIMIT 1;
  IF v_total >= COALESCE(v_rule.min_amount, 0) THEN
    v_earned_points := FLOOR(v_total * COALESCE(v_rule.points_per_unit, 0.001));
  END IF;

  UPDATE public.medicines SET stock = stock - p_quantity, updated_at = NOW()
  WHERE id = p_medicine_id RETURNING stock INTO v_new_stock;

  INSERT INTO public.medicine_sales (
    location_id, patient_id, medicine_id, quantity, unit_price, total_price,
    standard_total, discount_amount, pricing_note, date, treatment_id, loyalty_points_earned
  ) VALUES (
    p_location_id, p_patient_id, p_medicine_id, p_quantity, COALESCE(v_medicine.price, 0), v_total,
    v_standard_total, v_discount, v_pricing_note, COALESCE(p_sale_date, CURRENT_DATE), p_treatment_id, v_earned_points
  ) RETURNING * INTO v_sale;

  UPDATE public.patients
  SET balance = COALESCE(balance, 0) + v_total,
      loyalty_points = COALESCE(loyalty_points, 0) + v_earned_points
  WHERE id = p_patient_id RETURNING balance INTO v_new_balance;

  IF v_earned_points > 0 THEN
    INSERT INTO public.loyalty_transactions (patient_id, location_id, points, type, description)
    VALUES (p_patient_id, p_location_id, v_earned_points, 'EARNED',
      FORMAT('Earned from medicine purchase: %s (Qty: %s)', v_medicine.name, p_quantity));
  END IF;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale) || jsonb_build_object(
      'patient_name', v_patient.name, 'medicine_name', v_medicine.name, 'medicine_unit', v_medicine.unit
    ),
    'new_stock', v_new_stock,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE, NUMERIC) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sell_medicine_atomic(
  p_location_id UUID,
  p_patient_id UUID,
  p_medicine_id UUID,
  p_quantity NUMERIC,
  p_treatment_id UUID,
  p_sale_date DATE
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.sell_medicine_atomic(
    p_location_id, p_patient_id, p_medicine_id, p_quantity,
    p_treatment_id, p_sale_date, NULL::NUMERIC
  );
$$;

REVOKE ALL ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE) TO anon, authenticated;

COMMIT;