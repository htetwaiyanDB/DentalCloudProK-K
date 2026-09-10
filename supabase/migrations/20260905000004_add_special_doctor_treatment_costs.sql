-- Add Special Doctor Cost as a third treatment-cost category.
-- Existing table, RPC, permission, and route names remain unchanged for rolling deployments.
BEGIN;

-- Fail instead of waiting indefinitely behind production traffic. If either
-- timeout is reached, PostgreSQL rolls back this entire transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.patient_material_costs') IS NULL
     OR to_regclass('public.material_lab_cost_presets') IS NULL
     OR to_regclass('public.material_lab_cost_preset_settings') IS NULL
     OR to_regclass('public.pending_commission_recalculations') IS NULL
     OR to_regclass('public.expenses') IS NULL
     OR to_regprocedure('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'MLS migration prerequisites are missing; transaction was not applied.';
  END IF;
END;
$$;

ALTER TABLE public.patient_material_costs
  DROP CONSTRAINT IF EXISTS patient_material_costs_cost_type_check;
ALTER TABLE public.patient_material_costs
  ADD CONSTRAINT patient_material_costs_cost_type_check
  CHECK (cost_type IN ('material', 'lab', 'special_doctor')) NOT VALID;
ALTER TABLE public.patient_material_costs
  VALIDATE CONSTRAINT patient_material_costs_cost_type_check;

ALTER TABLE public.material_lab_cost_presets
  DROP CONSTRAINT IF EXISTS material_lab_cost_presets_cost_type_check;
ALTER TABLE public.material_lab_cost_presets
  ADD CONSTRAINT material_lab_cost_presets_cost_type_check
  CHECK (cost_type IN ('material', 'lab', 'special_doctor')) NOT VALID;
ALTER TABLE public.material_lab_cost_presets
  VALIDATE CONSTRAINT material_lab_cost_presets_cost_type_check;

CREATE OR REPLACE FUNCTION public.delete_audit_log_material_expense()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.expenses
  WHERE source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost')
    AND source_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

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
  v_special_doctor_total NUMERIC(12,2);
  v_actor_username TEXT;
  v_location_id UUID;
  v_treatment_date DATE;
  v_patient_id UUID;
  v_patient_name TEXT;
  v_treatment_label TEXT;
  v_material_names TEXT;
  v_lab_names TEXT;
  v_special_doctor_names TEXT;
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
    COALESCE(SUM(total_amount) FILTER (WHERE cost_type = 'special_doctor'), 0),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'material'), ''),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'lab'), ''),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'special_doctor'), '')
  INTO v_material_total, v_lab_total, v_special_doctor_total,
    v_material_names, v_lab_names, v_special_doctor_names
  FROM public.patient_material_costs WHERE audit_log_id = p_audit_log_id;

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
  IF v_special_doctor_total > 0 THEN
    INSERT INTO public.expenses (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES (v_location_id, 'Special doctor cost - ' || v_patient_name || ' - ' || v_treatment_label || CASE WHEN v_special_doctor_names <> '' THEN ' (' || v_special_doctor_names || ')' ELSE '' END, v_special_doctor_total, 'Special Doctor Cost', v_treatment_date, 'special_doctor_cost', p_audit_log_id, true);
  END IF;

  INSERT INTO public.pending_commission_recalculations (patient_id, request_token, requested_at)
  VALUES (v_patient_id, p_request_token, NOW())
  ON CONFLICT (patient_id) DO UPDATE
  SET request_token = EXCLUDED.request_token, requested_at = EXCLUDED.requested_at;

  RETURN QUERY SELECT costs.* FROM public.patient_material_costs costs
  WHERE costs.audit_log_id = p_audit_log_id ORDER BY costs.created_at, costs.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_material_lab_cost_presets(
  p_items JSONB, p_expected_revision BIGINT, p_user_id UUID, p_session_token TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_current_revision BIGINT; v_next_revision BIGINT; v_presets JSONB; v_created_at_by_id JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u JOIN public.staff_auth_sessions s ON s.user_id = u.id
    WHERE u.id = p_user_id AND s.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
      AND s.revoked_at IS NULL AND s.expires_at > NOW()
      AND (u.role = 'admin' OR (u.role = 'normal' AND u.doctor_id IS NULL
        AND jsonb_typeof(u.allowed_tabs) = 'array' AND u.allowed_tabs ? 'material-cost'))
  ) THEN RAISE EXCEPTION 'A valid staff session with Treatment Costs permission is required.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Presets must be a JSON array.'; END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'A maximum of 100 presets is allowed.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) raw(item) WHERE jsonb_typeof(raw.item) <> 'object')
  THEN RAISE EXCEPTION 'Every preset must be an object.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) item(id UUID, cost_type TEXT, label TEXT, amount NUMERIC, sort_order INTEGER)
    WHERE item.id IS NULL OR item.cost_type NOT IN ('material', 'lab', 'special_doctor')
      OR btrim(COALESCE(item.label, '')) = '' OR char_length(btrim(item.label)) > 255
      OR item.amount IS NULL OR item.amount <= 0 OR item.amount > 9999999999.99
      OR item.sort_order IS NULL OR item.sort_order < 0 OR item.sort_order >= 100
  ) THEN RAISE EXCEPTION 'Each preset needs a unique id, category, label, positive amount, and valid order.'; END IF;
  IF EXISTS (SELECT item.id FROM jsonb_to_recordset(p_items) item(id UUID) GROUP BY item.id HAVING COUNT(*) > 1)
    OR EXISTS (SELECT item.sort_order FROM jsonb_to_recordset(p_items) item(sort_order INTEGER) GROUP BY item.sort_order HAVING COUNT(*) > 1)
  THEN RAISE EXCEPTION 'Preset identifiers and order values must be unique.'; END IF;

  SELECT settings.revision INTO v_current_revision
  FROM public.material_lab_cost_preset_settings settings WHERE settings.id = 1 FOR UPDATE;
  IF v_current_revision IS NULL THEN RAISE EXCEPTION 'Preset settings are not initialized.'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_current_revision THEN RAISE EXCEPTION 'Preset list changed on another device.'; END IF;
  SELECT COALESCE(jsonb_object_agg(presets.id::TEXT, to_jsonb(presets.created_at)), '{}'::JSONB)
  INTO v_created_at_by_id FROM public.material_lab_cost_presets presets;
  DELETE FROM public.material_lab_cost_presets WHERE id IS NOT NULL;
  INSERT INTO public.material_lab_cost_presets(id, cost_type, label, amount, sort_order, created_at, updated_at)
  SELECT item.id, item.cost_type, btrim(item.label), item.amount, item.sort_order,
    COALESCE((v_created_at_by_id ->> item.id::TEXT)::TIMESTAMPTZ, NOW()), NOW()
  FROM jsonb_to_recordset(p_items) item(id UUID, cost_type TEXT, label TEXT, amount NUMERIC, sort_order INTEGER);
  v_next_revision := v_current_revision + 1;
  UPDATE public.material_lab_cost_preset_settings SET revision = v_next_revision, updated_by = p_user_id, updated_at = NOW() WHERE id = 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', presets.id, 'cost_type', presets.cost_type, 'label', presets.label, 'amount', presets.amount,
    'sort_order', presets.sort_order, 'created_at', presets.created_at, 'updated_at', presets.updated_at
  ) ORDER BY presets.sort_order, presets.label), '[]'::JSONB)
  INTO v_presets FROM public.material_lab_cost_presets presets;
  RETURN jsonb_build_object('revision', v_next_revision, 'presets', v_presets);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_material_lab_cost_presets(JSONB, BIGINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_material_lab_cost_presets(JSONB, BIGINT, UUID, TEXT) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;