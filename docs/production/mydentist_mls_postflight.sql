-- MYDENTIST PRODUCTION - READ-ONLY MLS POSTFLIGHT
-- Run only after the MyDentist MLS migration reports success.
-- This script does not modify data or schema.

SELECT
  'MYDENTIST MLS POSTFLIGHT' AS verification,
  current_database() AS database_name,
  current_user AS database_user,
  now() AS checked_at;

SELECT
  conname AS constraint_name,
  convalidated AS validated,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.patient_material_costs'::regclass,
  'public.material_lab_cost_presets'::regclass
)
  AND conname IN (
    'patient_material_costs_cost_type_check',
    'material_lab_cost_presets_cost_type_check'
  )
ORDER BY conname;

SELECT
  position('special_doctor' IN pg_get_functiondef('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)'::regprocedure)) > 0
    AS treatment_rpc_supports_special_doctor,
  position('special_doctor' IN pg_get_functiondef('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)'::regprocedure)) > 0
    AS preset_rpc_supports_special_doctor,
  position('special_doctor_cost' IN pg_get_functiondef('public.delete_audit_log_material_expense()'::regprocedure)) > 0
    AS cleanup_trigger_supports_special_doctor;

SELECT
  has_function_privilege('anon', 'public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)', 'EXECUTE') AS anon_treatment_execute,
  has_function_privilege('authenticated', 'public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)', 'EXECUTE') AS authenticated_treatment_execute,
  has_function_privilege('anon', 'public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)', 'EXECUTE') AS anon_preset_execute,
  has_function_privilege('authenticated', 'public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)', 'EXECUTE') AS authenticated_preset_execute;

-- Must return zero rows.
SELECT 'patient_material_costs' AS table_name, cost_type, COUNT(*) AS invalid_rows
FROM public.patient_material_costs
WHERE cost_type NOT IN ('material', 'lab', 'special_doctor') OR cost_type IS NULL
GROUP BY cost_type
UNION ALL
SELECT 'material_lab_cost_presets', cost_type, COUNT(*)
FROM public.material_lab_cost_presets
WHERE cost_type NOT IN ('material', 'lab', 'special_doctor') OR cost_type IS NULL
GROUP BY cost_type;

-- Must return zero rows. It is also valid for this query to find no Special
-- Doctor rows yet, because the migration deliberately creates no production data.
WITH cost_totals AS (
  SELECT audit_log_id, SUM(total_amount)::numeric AS total_amount
  FROM public.patient_material_costs
  WHERE cost_type = 'special_doctor'
  GROUP BY audit_log_id
), expense_totals AS (
  SELECT source_id AS audit_log_id, SUM(amount)::numeric AS total_amount
  FROM public.expenses
  WHERE source_type = 'special_doctor_cost'
  GROUP BY source_id
)
SELECT
  COALESCE(c.audit_log_id, e.audit_log_id) AS audit_log_id,
  c.total_amount AS detail_total,
  e.total_amount AS expense_total
FROM cost_totals c
FULL JOIN expense_totals e USING (audit_log_id)
WHERE c.total_amount IS DISTINCT FROM e.total_amount;

SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version = '20260905000004';