-- Store MLS cost rows against the payment selected in the MLS page. The
-- existing RPC name is retained so deployed clients can roll forward safely;
-- legacy treatment-linked audit rows remain readable and editable.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.patient_material_costs') IS NULL
     OR to_regclass('public.payments') IS NULL
     OR to_regclass('public.expenses') IS NULL
     OR to_regclass('public.pending_commission_recalculations') IS NULL THEN
    RAISE EXCEPTION 'Payment-based MLS prerequisites are missing; transaction was not applied.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_treatment_costs(
  p_audit_log_id UUID,
  p_items JSONB,
  p_admin_user_id UUID,
  p_admin_password TEXT,
  p_request_token UUID
)
RETURNS SETOF public.patient_material_costs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_type TEXT;
  v_source_id UUID;
  v_material_total NUMERIC(12,2);
  v_lab_total NUMERIC(12,2);
  v_actor_username TEXT;
  v_location_id UUID;
  v_activity_date DATE;
  v_patient_id UUID;
  v_patient_name TEXT;
  v_activity_label TEXT;
  v_material_names TEXT;
  v_lab_names TEXT;
BEGIN
  SELECT a.source_type, a.source_id
  INTO v_source_type, v_source_id
  FROM public.audit_logs a
  WHERE a.id = p_audit_log_id
  FOR UPDATE;
  IF NOT FOUND OR v_source_type NOT IN ('treatment', 'payment') THEN
    RAISE EXCEPTION 'Treatment or payment audit row was not found.';
  END IF;

  IF v_source_type = 'payment' THEN
    SELECT pay.location_id,
           COALESCE(pay.payment_date, pay.created_at::DATE),
           pay.patient_id,
           COALESCE(patient.name, 'Unknown patient'),
           COALESCE(NULLIF((
             SELECT string_agg(DISTINCT COALESCE(t.description, 'Treatment'), ' + ')
             FROM public.treatments t
             WHERE t.id = ANY(COALESCE(pay.treatment_ids, ARRAY[]::UUID[]))
           ), ''), 'Payment')
    INTO v_location_id, v_activity_date, v_patient_id, v_patient_name, v_activity_label
    FROM public.payments pay
    LEFT JOIN public.patients patient ON patient.id = pay.patient_id
    WHERE pay.id = v_source_id
    FOR UPDATE OF pay;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment record was not found.'; END IF;
  ELSE
    SELECT treatment.location_id, treatment.date, treatment.patient_id,
           COALESCE(patient.name, 'Unknown patient'),
           COALESCE(treatment.description, 'Treatment')
    INTO v_location_id, v_activity_date, v_patient_id, v_patient_name, v_activity_label
    FROM public.treatments treatment
    LEFT JOIN public.patients patient ON patient.id = treatment.patient_id
    WHERE treatment.id = v_source_id
    FOR UPDATE OF treatment;
    IF NOT FOUND THEN RAISE EXCEPTION 'Treatment record was not found.'; END IF;
  END IF;

  SELECT users.username INTO v_actor_username
  FROM public.users users
  WHERE users.id = p_admin_user_id
    AND (
      (users.role = 'admin' AND (
        users.password = p_admin_password OR btrim(users.password) = btrim(p_admin_password)
        OR EXISTS (
          SELECT 1 FROM public.staff_auth_sessions session
          WHERE session.user_id = users.id
            AND session.session_token::TEXT = btrim(p_admin_password)
            AND session.revoked_at IS NULL AND session.expires_at > NOW()
        )
      ))
      OR (users.role = 'normal' AND users.doctor_id IS NULL
        AND jsonb_typeof(users.allowed_tabs) = 'array'
        AND users.allowed_tabs ? 'material-cost'
        AND (users.location_id IS NULL OR users.location_id = v_location_id)
        AND EXISTS (
          SELECT 1 FROM public.staff_auth_sessions session
          WHERE session.user_id = users.id
            AND session.session_token::TEXT = btrim(p_admin_password)
            AND session.revoked_at IS NULL AND session.expires_at > NOW()
        )
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid staff session with Treatment Costs permission is required.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Cost items must be a JSON array.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC)
    WHERE btrim(COALESCE(item.material_name, '')) = ''
      OR item.cost_type NOT IN ('material', 'lab', 'special_doctor')
      OR item.cost_amount IS NULL OR item.cost_amount <= 0
      OR item.quantity IS NULL OR item.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Every cost item requires a valid name, type, positive cost, and positive quantity.';
  END IF;

  DELETE FROM public.patient_material_costs WHERE audit_log_id = p_audit_log_id;
  INSERT INTO public.patient_material_costs
    (audit_log_id, material_name, cost_type, cost_amount, quantity, created_by, created_by_name)
  SELECT p_audit_log_id, btrim(item.material_name), item.cost_type, item.cost_amount, item.quantity,
         p_admin_user_id, v_actor_username
  FROM jsonb_to_recordset(p_items) item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC);

  SELECT
    COALESCE(SUM(total_amount) FILTER (WHERE cost_type = 'material'), 0),
    COALESCE(SUM(total_amount) FILTER (WHERE cost_type = 'lab'), 0),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'material'), ''),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'lab'), '')
  INTO v_material_total, v_lab_total, v_material_names, v_lab_names
  FROM public.patient_material_costs
  WHERE audit_log_id = p_audit_log_id;

  DELETE FROM public.expenses
  WHERE source_id = p_audit_log_id
    AND source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost');
  IF v_material_total > 0 THEN
    INSERT INTO public.expenses
      (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES
      (v_location_id, 'Material cost - ' || v_patient_name || ' - ' || v_activity_label
       || CASE WHEN v_material_names <> '' THEN ' (' || v_material_names || ')' ELSE '' END,
       v_material_total, 'Material Cost', v_activity_date, 'material_cost', p_audit_log_id, true);
  END IF;
  IF v_lab_total > 0 THEN
    INSERT INTO public.expenses
      (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES
      (v_location_id, 'Lab cost - ' || v_patient_name || ' - ' || v_activity_label
       || CASE WHEN v_lab_names <> '' THEN ' (' || v_lab_names || ')' ELSE '' END,
       v_lab_total, 'Lab Cost', v_activity_date, 'lab_cost', p_audit_log_id, true);
  END IF;

  INSERT INTO public.pending_commission_recalculations (patient_id, request_token, requested_at)
  VALUES (v_patient_id, p_request_token, NOW())
  ON CONFLICT (patient_id) DO UPDATE
  SET request_token = EXCLUDED.request_token, requested_at = EXCLUDED.requested_at;

  RETURN QUERY
  SELECT costs.* FROM public.patient_material_costs costs
  WHERE costs.audit_log_id = p_audit_log_id
  ORDER BY costs.created_at, costs.id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
