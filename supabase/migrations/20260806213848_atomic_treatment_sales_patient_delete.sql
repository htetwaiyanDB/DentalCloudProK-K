BEGIN;

CREATE OR REPLACE FUNCTION public.sell_medicine_atomic(
  p_location_id UUID,
  p_patient_id UUID,
  p_medicine_id UUID,
  p_quantity NUMERIC,
  p_treatment_id UUID,
  p_sale_date DATE
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
  v_total NUMERIC(12,2);
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

  SELECT * INTO v_patient
  FROM public.patients
  WHERE id = p_patient_id AND location_id = p_location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient not found in this location';
  END IF;

  SELECT * INTO v_medicine
  FROM public.medicines
  WHERE id = p_medicine_id AND location_id = p_location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine not found in this location';
  END IF;
  IF COALESCE(v_medicine.stock, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for %. Available: % %',
      v_medicine.name, COALESCE(v_medicine.stock, 0), COALESCE(v_medicine.unit, '');
  END IF;

  IF p_treatment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.treatments
    WHERE id = p_treatment_id
      AND patient_id = p_patient_id
      AND location_id = p_location_id
  ) THEN
    RAISE EXCEPTION 'Treatment not found for this patient and location';
  END IF;

  v_total := ROUND(COALESCE(v_medicine.price, 0) * p_quantity, 2);

  SELECT * INTO v_rule
  FROM public.loyalty_rules
  WHERE location_id = p_location_id
    AND event_type = 'PURCHASE'
    AND active = TRUE
  ORDER BY name, id
  LIMIT 1;

  IF v_total >= COALESCE(v_rule.min_amount, 0) THEN
    v_earned_points := FLOOR(v_total * COALESCE(v_rule.points_per_unit, 0.001));
  END IF;

  UPDATE public.medicines
  SET stock = stock - p_quantity,
      updated_at = NOW()
  WHERE id = p_medicine_id
  RETURNING stock INTO v_new_stock;

  INSERT INTO public.medicine_sales (
    location_id, patient_id, medicine_id, quantity, unit_price, total_price, date, treatment_id
  ) VALUES (
    p_location_id, p_patient_id, p_medicine_id, p_quantity,
    COALESCE(v_medicine.price, 0), v_total, COALESCE(p_sale_date, CURRENT_DATE), p_treatment_id
  )
  RETURNING * INTO v_sale;

  UPDATE public.patients
  SET balance = COALESCE(balance, 0) + v_total,
      loyalty_points = COALESCE(loyalty_points, 0) + v_earned_points
  WHERE id = p_patient_id
  RETURNING balance INTO v_new_balance;

  IF v_earned_points > 0 THEN
    INSERT INTO public.loyalty_transactions (
      patient_id, location_id, points, type, description
    ) VALUES (
      p_patient_id,
      p_location_id,
      v_earned_points,
      'EARNED',
      FORMAT('Earned from medicine purchase: %s (Qty: %s)', v_medicine.name, p_quantity)
    );
  END IF;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale) || jsonb_build_object(
      'patient_name', v_patient.name,
      'medicine_name', v_medicine.name,
      'medicine_unit', v_medicine.unit
    ),
    'new_stock', v_new_stock,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_medicine_atomic(UUID, UUID, UUID, NUMERIC, UUID, DATE) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_treatment_atomic(
  p_location_id UUID,
  p_patient_id UUID,
  p_doctor_id UUID,
  p_treatment_type_id UUID,
  p_teeth INTEGER[],
  p_description TEXT,
  p_cost NUMERIC,
  p_standard_cost NUMERIC,
  p_discount_amount NUMERIC,
  p_pricing_note TEXT,
  p_medications JSONB,
  p_treatment_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_treatment public.treatments%ROWTYPE;
  v_rule public.loyalty_rules%ROWTYPE;
  v_medication RECORD;
  v_sale_result JSONB;
  v_sales JSONB := '[]'::JSONB;
  v_earned_points INTEGER := 0;
  v_new_balance NUMERIC(12,2);
  v_appointment_id UUID;
  v_completed_ids JSONB := '[]'::JSONB;
  v_doctor_name TEXT;
BEGIN
  IF p_location_id IS NULL OR p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Location and patient are required';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'Treatment cost must be at least 0';
  END IF;
  IF COALESCE(p_standard_cost, p_cost) < 0 OR COALESCE(p_discount_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Treatment pricing values must be at least 0';
  END IF;
  IF p_pricing_note IS NOT NULL AND p_pricing_note NOT IN ('FOC', 'DISCOUNT') THEN
    RAISE EXCEPTION 'Invalid treatment pricing note';
  END IF;
  IF jsonb_typeof(COALESCE(p_medications, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Medications must be a JSON array';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients
  WHERE id = p_patient_id AND location_id = p_location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient not found in this location';
  END IF;

  INSERT INTO public.treatments (
    location_id, patient_id, doctor_id, treatment_type_id, teeth, description,
    cost, standard_cost, discount_amount, pricing_note, doctor_earnings, date
  ) VALUES (
    p_location_id, p_patient_id, p_doctor_id, p_treatment_type_id,
    COALESCE(p_teeth, '{}'::INTEGER[]), p_description, p_cost,
    COALESCE(p_standard_cost, p_cost), COALESCE(p_discount_amount, 0),
    p_pricing_note, 0, COALESCE(p_treatment_date, CURRENT_DATE)
  )
  RETURNING * INTO v_treatment;

  FOR v_medication IN
    SELECT item.id::UUID AS id, SUM(item.qty) AS qty
    FROM jsonb_to_recordset(COALESCE(p_medications, '[]'::JSONB)) AS item(id TEXT, qty NUMERIC)
    GROUP BY item.id
    ORDER BY item.id::UUID
  LOOP
    IF v_medication.qty IS NULL OR v_medication.qty <= 0 THEN
      RAISE EXCEPTION 'Medicine quantity must be greater than 0';
    END IF;

    v_sale_result := public.sell_medicine_atomic(
      p_location_id,
      p_patient_id,
      v_medication.id,
      v_medication.qty,
      v_treatment.id,
      COALESCE(p_treatment_date, CURRENT_DATE)
    );
    v_sales := v_sales || jsonb_build_array(v_sale_result -> 'sale');
  END LOOP;

  SELECT * INTO v_rule
  FROM public.loyalty_rules
  WHERE location_id = p_location_id
    AND event_type = 'TREATMENT'
    AND active = TRUE
  ORDER BY name, id
  LIMIT 1;

  IF p_cost >= COALESCE(v_rule.min_amount, 0) THEN
    v_earned_points := FLOOR(p_cost * COALESCE(v_rule.points_per_unit, 0.001));
  END IF;

  UPDATE public.patients
  SET balance = COALESCE(balance, 0) + p_cost,
      loyalty_points = COALESCE(loyalty_points, 0) + v_earned_points
  WHERE id = p_patient_id
  RETURNING balance INTO v_new_balance;

  IF v_earned_points > 0 THEN
    INSERT INTO public.loyalty_transactions (
      patient_id, location_id, points, type, description
    ) VALUES (
      p_patient_id,
      p_location_id,
      v_earned_points,
      'EARNED',
      FORMAT('Earned from treatment: %s', COALESCE(p_description, 'Treatment'))
    );
  END IF;

  SELECT id INTO v_appointment_id
  FROM public.appointments
  WHERE location_id = p_location_id
    AND patient_id = p_patient_id
    AND date = COALESCE(p_treatment_date, CURRENT_DATE)
    AND status = 'Scheduled'
    AND (p_doctor_id IS NULL OR doctor_id = p_doctor_id)
  ORDER BY time, id
  LIMIT 1
  FOR UPDATE;

  IF v_appointment_id IS NULL AND p_doctor_id IS NOT NULL THEN
    SELECT id INTO v_appointment_id
    FROM public.appointments
    WHERE location_id = p_location_id
      AND patient_id = p_patient_id
      AND date = COALESCE(p_treatment_date, CURRENT_DATE)
      AND status = 'Scheduled'
    ORDER BY time, id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET status = 'Completed',
        clinical_fee_status = 'NOT_APPLICABLE',
        clinical_fee_amount = 0,
        clinical_fee_patient_category = NULL,
        clinical_fee_applied_at = NULL
    WHERE id = v_appointment_id;
    v_completed_ids := jsonb_build_array(v_appointment_id);
  END IF;

  IF p_doctor_id IS NOT NULL THEN
    SELECT name INTO v_doctor_name FROM public.doctors WHERE id = p_doctor_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'new_balance', v_new_balance,
    'completed_appointment_ids', v_completed_ids,
    'medication_sales', v_sales,
    'record', to_jsonb(v_treatment) || jsonb_build_object('doctor_name', v_doctor_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_treatment_atomic(UUID, UUID, UUID, UUID, INTEGER[], TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_treatment_atomic(UUID, UUID, UUID, UUID, INTEGER[], TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_patient_atomic(p_patient_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_preserved_appointments INTEGER := 0;
BEGIN
  IF p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Patient ID is required';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients
  WHERE id = p_patient_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  UPDATE public.appointments
  SET guest_name = CASE
        WHEN NULLIF(BTRIM(COALESCE(guest_name, '')), '') IS NULL
          THEN COALESCE(NULLIF(BTRIM(v_patient.name), ''), 'Unknown Patient')
        ELSE guest_name
      END,
      guest_phone = CASE
        WHEN NULLIF(BTRIM(COALESCE(guest_phone, '')), '') IS NULL
          THEN COALESCE(NULLIF(BTRIM(v_patient.phone), ''), 'N/A')
        ELSE guest_phone
      END
  WHERE patient_id = p_patient_id;
  GET DIAGNOSTICS v_preserved_appointments = ROW_COUNT;

  DELETE FROM public.patient_auth WHERE patient_id = p_patient_id;
  DELETE FROM public.payments WHERE patient_id = p_patient_id;
  DELETE FROM public.medicine_sales WHERE patient_id = p_patient_id;
  DELETE FROM public.loyalty_transactions WHERE patient_id = p_patient_id;
  DELETE FROM public.treatments WHERE patient_id = p_patient_id;
  DELETE FROM public.conversations WHERE patient_id = p_patient_id;
  DELETE FROM public.patients WHERE id = p_patient_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'patient_id', p_patient_id,
    'preserved_appointments', v_preserved_appointments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_patient_atomic(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_patient_atomic(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
