-- Keep Special Doctor Cost in MLS and profitability calculations, but do not
-- mirror it into the general Expenses ledger.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.patient_material_costs') IS NULL
     OR to_regclass('public.expenses') IS NULL
     OR to_regprocedure('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'MLS migration prerequisites are missing; transaction was not applied.';
  END IF;
END;
$$;

-- Remove only rows that the MLS workflow generated previously. User-created
-- expense rows, including rows with a similar description/category, are kept.
DELETE FROM public.expenses
WHERE source_type = 'special_doctor_cost'
  AND is_system_generated IS TRUE;

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
  v_material_total NUMERIC(12,2);
  v_lab_total NUMERIC(12,2);
  v_actor_username TEXT;
  v_location_id UUID;
  v_treatment_date DATE;
  v_patient_id UUID;
  v_patient_name TEXT;
  v_treatment_label TEXT;
  v_material_names TEXT;
  v_lab_names TEXT;
BEGIN
  SELECT t.location_id, t.date, t.patient_id, COALESCE(p.name, 'Unknown patient'), COALESCE(t.description, 'Treatment')
  INTO v_location_id, v_treatment_date, v_patient_id, v_patient_name, v_treatment_label
  FROM public.audit_logs a
  JOIN public.treatments t ON t.id = a.source_id
  LEFT JOIN public.patients p ON p.id = t.patient_id
  WHERE a.id = p_audit_log_id AND a.source_type = 'treatment'
  FOR UPDATE OF a, t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Treatment audit row was not found.'; END IF;

  SELECT u.username INTO v_actor_username
  FROM public.users u
  WHERE u.id = p_admin_user_id
    AND (
      (u.role = 'admin' AND (
        u.password = p_admin_password OR btrim(u.password) = btrim(p_admin_password)
        OR EXISTS (
          SELECT 1 FROM public.staff_auth_sessions s
          WHERE s.user_id = u.id AND s.session_token::TEXT = btrim(p_admin_password)
            AND s.revoked_at IS NULL AND s.expires_at > NOW()
        )
      ))
      OR (u.role = 'normal' AND u.doctor_id IS NULL
        AND jsonb_typeof(u.allowed_tabs) = 'array'
        AND u.allowed_tabs ? 'material-cost'
        AND (u.location_id IS NULL OR u.location_id = v_location_id)
        AND EXISTS (
          SELECT 1 FROM public.staff_auth_sessions s
          WHERE s.user_id = u.id AND s.session_token::TEXT = btrim(p_admin_password)
            AND s.revoked_at IS NULL AND s.expires_at > NOW()
        )
      )
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid staff session with Treatment Costs permission is required.'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cost items must be a JSON array.'; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC)
    WHERE btrim(COALESCE(item.material_name, '')) = ''
      OR item.cost_type NOT IN ('material', 'lab', 'special_doctor')
      OR item.cost_amount IS NULL OR item.cost_amount <= 0
      OR item.quantity IS NULL OR item.quantity <= 0
  ) THEN RAISE EXCEPTION 'Every cost item requires a valid name, type, positive cost, and positive quantity.'; END IF;

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
  FROM public.patient_material_costs WHERE audit_log_id = p_audit_log_id;

  -- Include the old special-doctor source type in cleanup so an MLS save also
  -- removes a stale generated expense from databases upgraded in place.
  DELETE FROM public.expenses
  WHERE source_id = p_audit_log_id
    AND source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost');
  IF v_material_total > 0 THEN
    INSERT INTO public.expenses (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES (v_location_id, 'Material cost - ' || v_patient_name || ' - ' || v_treatment_label || CASE WHEN v_material_names <> '' THEN ' (' || v_material_names || ')' ELSE '' END, v_material_total, 'Material Cost', v_treatment_date, 'material_cost', p_audit_log_id, true);
  END IF;
  IF v_lab_total > 0 THEN
    INSERT INTO public.expenses (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES (v_location_id, 'Lab cost - ' || v_patient_name || ' - ' || v_treatment_label || CASE WHEN v_lab_names <> '' THEN ' (' || v_lab_names || ')' ELSE '' END, v_lab_total, 'Lab Cost', v_treatment_date, 'lab_cost', p_audit_log_id, true);
  END IF;

  INSERT INTO public.pending_commission_recalculations (patient_id, request_token, requested_at)
  VALUES (v_patient_id, p_request_token, NOW())
  ON CONFLICT (patient_id) DO UPDATE
  SET request_token = EXCLUDED.request_token, requested_at = EXCLUDED.requested_at;

  RETURN QUERY SELECT costs.* FROM public.patient_material_costs costs
  WHERE costs.audit_log_id = p_audit_log_id ORDER BY costs.created_at, costs.id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
