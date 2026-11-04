-- Independent MLS dates. No historical expense rebuild and no new commission rules.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.patient_material_costs ADD COLUMN IF NOT EXISTS expense_date DATE;
UPDATE public.patient_material_costs c
SET expense_date = CASE a.source_type
  WHEN 'payment' THEN COALESCE(p.payment_date, p.created_at::DATE)
  WHEN 'treatment' THEN t.date END
FROM public.audit_logs a
LEFT JOIN public.payments p ON a.source_type = 'payment' AND p.id = a.source_id
LEFT JOIN public.treatments t ON a.source_type = 'treatment' AND t.id = a.source_id
WHERE c.audit_log_id = a.id AND c.expense_date IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.patient_material_costs WHERE expense_date IS NULL) THEN
    RAISE EXCEPTION 'MLS dates cannot be backfilled: repair missing original activity dates first. No changes applied.';
  END IF;
END $$;
ALTER TABLE public.patient_material_costs ALTER COLUMN expense_date SET NOT NULL;
-- Deliberately no CURRENT_DATE default: unknown attribution must fail closed.
CREATE INDEX IF NOT EXISTS idx_patient_material_costs_expense_date
  ON public.patient_material_costs (expense_date, cost_type);

-- Keep the original uniqueness rule for all non-MLS sources.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_non_mls_source_unique
  ON public.expenses (source_type, source_id)
  WHERE source_type NOT IN ('material_cost', 'lab_cost');
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_mls_source_date_unique
  ON public.expenses (source_type, source_id, date) NULLS NOT DISTINCT
  WHERE source_type IN ('material_cost', 'lab_cost');
DROP INDEX IF EXISTS public.idx_expenses_source_unique;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_type TEXT;
  v_source_id UUID;
  v_actor_username TEXT;
  v_location_id UUID;
  v_activity_date DATE;
  v_patient_id UUID;
  v_patient_name TEXT;
  v_activity_label TEXT;
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
      OR (users.role <> 'admin' AND users.allowed_tabs ? 'material-cost' AND EXISTS (
        SELECT 1 FROM public.staff_auth_sessions session
        WHERE session.user_id = users.id
          AND session.session_token::TEXT = btrim(p_admin_password)
          AND session.revoked_at IS NULL AND session.expires_at > NOW()
      ))
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid staff session with Treatment Costs permission is required.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Cost items must be a JSON array.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    WHERE jsonb_typeof(item) <> 'object'
      OR jsonb_typeof(item->'expense_date') IS DISTINCT FROM 'string'
      OR COALESCE(item->>'expense_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) THEN
    RAISE EXCEPTION 'Every MLS item requires an expense date. Please reload or upgrade the application before saving.';
  END IF;
  -- DATE conversion rejects impossible dates; textual roundtrip rejects normalization.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) item(expense_date TEXT)
    WHERE item.expense_date::DATE::TEXT <> item.expense_date
  ) THEN RAISE EXCEPTION 'Every expense date must be a valid ISO calendar date.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) item(id UUID)
    WHERE item.id IS NOT NULL GROUP BY item.id HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Duplicate MLS item IDs are not allowed.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) item(id UUID)
    WHERE item.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.patient_material_costs c
      WHERE c.id = item.id AND c.audit_log_id = p_audit_log_id
    )
  ) THEN RAISE EXCEPTION 'MLS item does not belong to this activity. Please reload before saving.'; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC, doctor_id UUID)
    WHERE btrim(COALESCE(item.material_name, '')) = ''
      OR item.cost_type IS NULL OR item.cost_type NOT IN ('material', 'lab', 'special_doctor')
      OR item.cost_amount IS NULL OR item.cost_amount <= 0
      OR item.quantity IS NULL OR item.quantity <= 0
      OR (item.doctor_id IS NOT NULL AND (item.cost_type <> 'special_doctor' OR NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = item.doctor_id)))
  ) THEN
    RAISE EXCEPTION 'Every cost item requires a valid name, type, positive cost, and positive quantity.';
  END IF;

  DELETE FROM public.patient_material_costs c WHERE audit_log_id = p_audit_log_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) item(id UUID) WHERE item.id = c.id);
  UPDATE public.patient_material_costs c
  SET material_name = btrim(item.material_name), cost_type = item.cost_type,
      cost_amount = item.cost_amount, quantity = item.quantity,
      doctor_id = CASE WHEN item.cost_type = 'special_doctor' THEN item.doctor_id ELSE NULL END,
      expense_date = item.expense_date, updated_at = NOW()
  FROM jsonb_to_recordset(p_items) item(id UUID, material_name TEXT, cost_type TEXT,
    cost_amount NUMERIC, quantity NUMERIC, doctor_id UUID, expense_date DATE)
  WHERE c.id = item.id AND c.audit_log_id = p_audit_log_id;
  INSERT INTO public.patient_material_costs
    (audit_log_id, material_name, cost_type, cost_amount, quantity, doctor_id, created_by, created_by_name, expense_date)
  SELECT p_audit_log_id, btrim(item.material_name), item.cost_type, item.cost_amount, item.quantity,
         CASE WHEN item.cost_type = 'special_doctor' THEN item.doctor_id ELSE NULL END,
          p_admin_user_id, v_actor_username, item.expense_date
  FROM jsonb_to_recordset(p_items) item(id UUID, material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC, doctor_id UUID, expense_date DATE)
  WHERE item.id IS NULL;

  -- Source remains the audit ID so existing deletion/undo triggers remove every date.
  DELETE FROM public.expenses
  WHERE source_id = p_audit_log_id
    AND source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost');
  INSERT INTO public.expenses
    (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
  SELECT v_location_id,
         CASE c.cost_type WHEN 'material' THEN 'Material cost - ' ELSE 'Lab cost - ' END
           || v_patient_name || ' - ' || v_activity_label
           || ' (' || string_agg(c.material_name, ', ' ORDER BY c.created_at, c.id) || ')',
         SUM(c.total_amount),
         CASE c.cost_type WHEN 'material' THEN 'Material Cost' ELSE 'Lab Cost' END,
         c.expense_date, c.cost_type || '_cost', p_audit_log_id, true
  FROM public.patient_material_costs c
  WHERE c.audit_log_id = p_audit_log_id AND c.cost_type IN ('material', 'lab')
  GROUP BY c.cost_type, c.expense_date;
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

-- Each lateral aggregate returns at most one row, even for multi-treatment payments.
CREATE OR REPLACE VIEW public.mls_expense_report
WITH (security_invoker = true) AS
SELECT c.id, c.expense_date, c.cost_type, c.total_amount,
       COALESCE(p.patient_id, t.patient_id, a.patient_id) AS patient_id,
       COALESCE(patient.name, 'Unknown patient') AS patient_name,
       COALESCE(t.description, linked.treatment_label, 'Payment') AS treatment_label,
       COALESCE(t.date, linked.treatment_date, p.payment_date,
                p.created_at::DATE, c.expense_date) AS treatment_date,
       COALESCE(doctor.name, linked.doctor_name, audit_doctor.name, '') AS doctor_name,
       patient.patient_type, a.source_type, a.source_id,
       COALESCE(p.location_id, t.location_id, a.location_id) AS location_id
FROM public.patient_material_costs c
JOIN public.audit_logs a ON a.id = c.audit_log_id
LEFT JOIN public.payments p ON a.source_type = 'payment' AND p.id = a.source_id
LEFT JOIN public.treatments t ON a.source_type = 'treatment' AND t.id = a.source_id
LEFT JOIN public.patients patient ON patient.id = COALESCE(p.patient_id, t.patient_id, a.patient_id)
LEFT JOIN public.doctors doctor ON doctor.id = t.doctor_id
LEFT JOIN public.doctors audit_doctor ON audit_doctor.id = a.doctor_id
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT COALESCE(pt.description, 'Treatment'), ' + '
                    ORDER BY COALESCE(pt.description, 'Treatment')) AS treatment_label,
         MIN(pt.date) AS treatment_date,
         string_agg(DISTINCT pd.name, ', ' ORDER BY pd.name) AS doctor_name
  FROM public.treatments pt
  LEFT JOIN public.doctors pd ON pd.id = pt.doctor_id
  WHERE pt.id = ANY(COALESCE(p.treatment_ids, ARRAY[]::UUID[]))
) linked ON true;
GRANT SELECT ON public.mls_expense_report TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

