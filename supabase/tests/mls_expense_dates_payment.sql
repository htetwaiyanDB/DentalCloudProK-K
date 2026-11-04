-- Run AFTER 20261104000000_mls_expense_dates.sql as the database owner.
-- Covers MLS costs stored against a payment that links more than one treatment:
-- the report view must stay one row per cost (no multiplication) while the
-- generated Material/Lab expenses split by expense date.
-- Synthetic fixtures only; ends with ROLLBACK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$
DECLARE
  actor UUID := gen_random_uuid();
  patient UUID := gen_random_uuid();
  treatment_a UUID := gen_random_uuid();
  treatment_b UUID := gen_random_uuid();
  payment UUID := gen_random_uuid();
  location UUID;
  audit UUID;
  item_id UUID;
  created TIMESTAMPTZ;
  token UUID := gen_random_uuid();
  password TEXT := gen_random_uuid()::TEXT;
  items JSONB;
  failed BOOLEAN;
BEGIN
  SELECT id INTO STRICT location FROM public.locations ORDER BY id LIMIT 1;

  INSERT INTO public.users(id, username, password, role)
    VALUES(actor, 'mls-pay-test-' || actor, password, 'admin');
  INSERT INTO public.patients(id, patient_unique_id, name)
    VALUES(patient, 'TP-' || left(patient::TEXT, 16), 'Synthetic payment MLS test');
  INSERT INTO public.treatments(id, patient_id, location_id, description, date, cost)
    VALUES
      (treatment_a, patient, location, 'Crown A', DATE '2020-01-02', 1000),
      (treatment_b, patient, location, 'Crown B', DATE '2020-02-05', 500);
  INSERT INTO public.payments(id, location_id, patient_id, amount, original_amount,
                              cleared_amount, balance_before, remaining_balance,
                              payment_method, payment_status, treatment_ids, payment_date)
    VALUES(payment, location, patient, 600, 1500, 600, 1500, 900,
           'CASH', 'PARTIAL', ARRAY[treatment_a, treatment_b], DATE '2020-02-06');
  INSERT INTO public.audit_logs(source_type, source_id, payment_id, patient_id, location_id)
    VALUES('payment', payment, payment, patient, location)
    ON CONFLICT (source_type, source_id) DO NOTHING;
  SELECT id INTO STRICT audit
    FROM public.audit_logs WHERE source_type = 'payment' AND source_id = payment;

  items := '[
    {"material_name":"A","cost_type":"material","cost_amount":10,"quantity":2,"expense_date":"2021-01-01"},
    {"material_name":"B","cost_type":"lab","cost_amount":30,"quantity":1,"expense_date":"2021-02-01"},
    {"material_name":"C","cost_type":"lab","cost_amount":5,"quantity":1,"expense_date":"2021-02-01"},
    {"material_name":"D","cost_type":"special_doctor","cost_amount":50,"quantity":1,"expense_date":"2021-03-01"}]';
  PERFORM public.replace_treatment_costs(audit, items, actor, password, token);

  -- One expense per cost type and expense date; Special Doctor never generates one.
  ASSERT (SELECT count(*) = 2 AND sum(amount) = 55
          FROM public.expenses WHERE source_id = audit),
    'Payment MLS expenses were not split by type and expense date';
  ASSERT (SELECT amount = 20 AND date = DATE '2021-01-01'
          FROM public.expenses WHERE source_id = audit AND source_type = 'material_cost'),
    'Material expense date or total is wrong';
  ASSERT (SELECT amount = 35 AND date = DATE '2021-02-01'
          FROM public.expenses WHERE source_id = audit AND source_type = 'lab_cost'),
    'Lab expense should merge same-date rows only';

  -- The report view must not multiply rows for a two-treatment payment.
  ASSERT (SELECT count(*) = 4 AND sum(total_amount) = 105
          FROM public.mls_expense_report WHERE source_id = payment),
    'Report view multiplied or dropped payment-linked MLS costs';
  ASSERT (SELECT bool_and(source_type = 'payment' AND location_id = location)
          FROM public.mls_expense_report WHERE source_id = payment),
    'Report view lost payment source or branch';
  ASSERT (SELECT count(DISTINCT treatment_label) = 1
                 AND bool_and(treatment_label = 'Crown A + Crown B' AND treatment_date = DATE '2020-01-02')
          FROM public.mls_expense_report WHERE source_id = payment),
    'Report view did not aggregate linked treatments without changing original dates';
  ASSERT (SELECT request_token = token
          FROM public.pending_commission_recalculations WHERE patient_id = patient),
    'Commission queue not preserved for payment-linked costs';

  -- Resaving with stable IDs must keep identity, creation metadata, and dates.
  SELECT id, created_at INTO item_id, created
    FROM public.patient_material_costs WHERE audit_log_id = audit AND material_name = 'A';
  SELECT jsonb_agg(to_jsonb(c)) INTO items
    FROM public.patient_material_costs c WHERE audit_log_id = audit;
  PERFORM public.replace_treatment_costs(audit, items, actor, password, token);
  ASSERT (SELECT created_at = created AND created_by = actor AND expense_date = DATE '2021-01-01'
          FROM public.patient_material_costs WHERE id = item_id),
    'Payment resave lost stable ID, creation metadata, or expense date';
  ASSERT (SELECT count(*) = 2 AND sum(amount) = 55
          FROM public.expenses WHERE source_id = audit),
    'Payment resave changed expense rows';

  -- Correcting one late lab cost must move only that expense row.
  items := (SELECT jsonb_agg(
             CASE WHEN item->>'material_name' IN ('B', 'C')
                  THEN item || '{"expense_date":"2021-04-01"}'::JSONB
                  ELSE item END)
           FROM jsonb_array_elements(items) AS item);
  PERFORM public.replace_treatment_costs(audit, items, actor, password, token);
  ASSERT (SELECT count(*) = 2 AND sum(amount) = 55
          FROM public.expenses WHERE source_id = audit),
    'Correcting an expense date duplicated or dropped rows';
  ASSERT (SELECT amount = 35 AND date = DATE '2021-04-01'
          FROM public.expenses WHERE source_id = audit AND source_type = 'lab_cost'),
    'Corrected lab expense date was not applied';
  ASSERT NOT EXISTS (SELECT 1 FROM public.expenses
                     WHERE source_id = audit AND date = DATE '2021-02-01'),
    'Old lab expense row survived the date correction';

  -- A legacy client payload without dates must fail without changing stored data.
  failed := false;
  BEGIN
    PERFORM public.replace_treatment_costs(audit,
      (SELECT jsonb_agg(item - 'expense_date') FROM jsonb_array_elements(items) item),
      actor, password, token);
  EXCEPTION WHEN OTHERS THEN failed := true;
  END;
  ASSERT failed, 'Legacy payload without expense dates was accepted';
  ASSERT (SELECT count(*) = 4 FROM public.patient_material_costs WHERE audit_log_id = audit),
    'Rejected legacy payload changed stored costs';

  -- Deleting the payment must remove every split expense through the audit trigger.
  DELETE FROM public.payments WHERE id = payment;
  ASSERT NOT EXISTS (SELECT 1 FROM public.expenses WHERE source_id = audit),
    'Payment deletion left split MLS expenses behind';
  ASSERT NOT EXISTS (SELECT 1 FROM public.patient_material_costs WHERE audit_log_id = audit),
    'Payment deletion left MLS costs behind';
END $$;
ROLLBACK;
