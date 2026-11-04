-- Run AFTER the migration on an isolated schema clone as its owner.
-- All fixtures are synthetic; no real users, passwords or patient rows are read.
-- Use psql -v ON_ERROR_STOP=1 -f supabase/tests/mls_expense_dates.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$
DECLARE
  actor UUID := gen_random_uuid();
  patient UUID := gen_random_uuid();
  treatment UUID := gen_random_uuid();
  audit UUID;
  other_audit UUID;
  item_id UUID;
  created TIMESTAMPTZ;
  token UUID := gen_random_uuid();
  password TEXT := gen_random_uuid()::TEXT;
  items JSONB;
  bad JSONB;
  failed BOOLEAN;
BEGIN
  INSERT INTO public.users(id, username, password, role)
    VALUES(actor, 'mls-test-' || actor, password, 'admin');
  -- Explicit patient_unique_id avoids advancing a real nontransactional sequence.
  INSERT INTO public.patients(id, patient_unique_id, name)
    VALUES(patient, 'T-' || left(patient::TEXT, 18), 'Synthetic MLS test');
  INSERT INTO public.treatments(id, patient_id, description, date, cost)
    VALUES(treatment, patient, 'Synthetic MLS treatment', DATE '2020-01-02', 1000);
  INSERT INTO public.audit_logs(source_type, source_id, treatment_id, patient_id)
    VALUES('treatment', treatment, treatment, patient)
    ON CONFLICT (source_type, source_id) DO NOTHING;
  SELECT id INTO STRICT audit FROM public.audit_logs WHERE source_type = 'treatment' AND source_id = treatment;
  items := '[{"material_name":"A","cost_type":"material","cost_amount":10,"quantity":2,"expense_date":"2021-01-01"},
             {"material_name":"B","cost_type":"material","cost_amount":30,"quantity":1,"expense_date":"2021-02-01"},
             {"material_name":"C","cost_type":"lab","cost_amount":40,"quantity":1,"expense_date":"2021-02-01"},
             {"material_name":"D","cost_type":"special_doctor","cost_amount":50,"quantity":1,"expense_date":"2021-03-01"}]';
  PERFORM public.replace_treatment_costs(audit, items, actor, password, token);
  ASSERT (SELECT count(*) = 3 AND sum(amount) = 90 FROM public.expenses WHERE source_id = audit), 'Date/type grouping or special doctor policy failed';
  ASSERT (SELECT count(*) = 4 AND sum(total_amount) = 140 FROM public.mls_expense_report WHERE source_id = treatment), 'Report cardinality/totals failed';
  ASSERT (SELECT bool_and(treatment_date = DATE '2020-01-02') FROM public.mls_expense_report WHERE source_id = treatment), 'Treatment date changed';
  ASSERT (SELECT request_token = token FROM public.pending_commission_recalculations WHERE patient_id = patient), 'Commission queue not preserved';
  SELECT id, created_at INTO item_id, created FROM public.patient_material_costs WHERE audit_log_id = audit AND material_name = 'A';
  SELECT jsonb_agg(to_jsonb(c)) INTO items FROM public.patient_material_costs c WHERE audit_log_id = audit;
  PERFORM public.replace_treatment_costs(audit, items, actor, password, token);
  ASSERT (SELECT created_at = created AND created_by = actor AND expense_date = DATE '2021-01-01' FROM public.patient_material_costs WHERE id = item_id), 'Stable ID/date/creation metadata lost';
  -- Every invalid call must fail before replacing any rows.
  FOREACH bad IN ARRAY ARRAY[
    (items->0) || '{}'::JSONB,
    jsonb_build_array((items->0) - 'expense_date'),
    jsonb_build_array((items->0) || '{"expense_date":"2021-02-30"}'),
    jsonb_build_array(items->0, items->0),
    jsonb_build_array((items->0) || jsonb_build_object('id', gen_random_uuid())),
    jsonb_build_array((items->0) || '{"cost_type":null}')
  ] LOOP
    failed := false;
    BEGIN
      PERFORM public.replace_treatment_costs(audit, bad, actor, password, token);
    EXCEPTION WHEN OTHERS THEN failed := true;
    END;
    ASSERT failed, 'Invalid payload accepted';
    ASSERT (SELECT count(*) = 4 AND sum(total_amount) = 140 FROM public.patient_material_costs WHERE audit_log_id = audit), 'Rejected write changed costs';
  END LOOP;
  failed := false;
  BEGIN
    PERFORM public.replace_treatment_costs(audit, items, actor, 'invalid synthetic session', token);
  EXCEPTION WHEN OTHERS THEN failed := true;
  END;
  ASSERT failed, 'Authorization bypass';
  DELETE FROM public.audit_logs WHERE id = audit;
  ASSERT NOT EXISTS (SELECT 1 FROM public.expenses WHERE source_id = audit), 'Audit deletion left split expenses';
  ASSERT NOT EXISTS (SELECT 1 FROM public.patient_material_costs WHERE audit_log_id = audit), 'Audit deletion left costs';
  ASSERT (SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.mls_expense_report'::regclass), 'Report bypasses RLS';
END $$;
ROLLBACK;