-- Owner-run harness, on a LOCAL/isolated database only, single connection:
-- 1. Execute this file through the SET LOCAL statements and snapshots below.
-- 2. Execute migration 20261104000000_mls_expense_dates.sql twice, REMOVING
--    only its top-level BEGIN and COMMIT each time (keep both inside this TX).
-- 3. Execute the DO block and ROLLBACK below. Never include the migration's COMMIT.
-- This separation is intentional: plain SQL cannot include a client-side file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE mls_before ON COMMIT DROP AS
SELECT c.id, c.audit_log_id, c.cost_type, c.total_amount, c.created_at, c.created_by,
       COALESCE((to_jsonb(c)->>'expense_date')::DATE,
         CASE a.source_type WHEN 'payment' THEN COALESCE(p.payment_date, p.created_at::DATE)
                            WHEN 'treatment' THEN t.date END) AS expected_date
FROM public.patient_material_costs c
JOIN public.audit_logs a ON a.id = c.audit_log_id
LEFT JOIN public.payments p ON a.source_type = 'payment' AND p.id = a.source_id
LEFT JOIN public.treatments t ON a.source_type = 'treatment' AND t.id = a.source_id;
CREATE TEMP TABLE expenses_before ON COMMIT DROP AS SELECT to_jsonb(e) AS row FROM public.expenses e;

-- INSERT TWO MIGRATION BODIES HERE in the test runner, without transaction wrappers.
DO $$ BEGIN
  ASSERT NOT EXISTS (
    (SELECT id, audit_log_id, cost_type, total_amount, created_at, created_by, expected_date FROM mls_before
     EXCEPT SELECT id, audit_log_id, cost_type, total_amount, created_at, created_by, expense_date FROM public.patient_material_costs)
    UNION ALL
    (SELECT id, audit_log_id, cost_type, total_amount, created_at, created_by, expense_date FROM public.patient_material_costs
     EXCEPT SELECT id, audit_log_id, cost_type, total_amount, created_at, created_by, expected_date FROM mls_before)
  ), 'Migration/rerun changed IDs, attribution, totals or creation metadata';
  ASSERT NOT EXISTS (
    (SELECT row FROM expenses_before EXCEPT SELECT to_jsonb(e) FROM public.expenses e)
    UNION ALL
    (SELECT to_jsonb(e) FROM public.expenses e EXCEPT SELECT row FROM expenses_before)
  ), 'Migration recreated historical expenses';
  ASSERT (SELECT count(*) FROM public.mls_expense_report) = (SELECT count(*) FROM public.patient_material_costs), 'Report multiplies cost rows';
  ASSERT (SELECT COALESCE(sum(total_amount),0) FROM public.mls_expense_report) = (SELECT COALESCE(sum(total_amount),0) FROM public.patient_material_costs), 'Report total mismatch';
END $$;
ROLLBACK;