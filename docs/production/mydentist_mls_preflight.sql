-- MYDENTIST PRODUCTION - READ-ONLY MLS PREFLIGHT
-- Run only in the MyDentist Supabase project before the MLS migration.
-- This script does not modify data or schema.

SELECT
  'MYDENTIST - STOP IF THIS IS NOT THE SELECTED DASHBOARD PROJECT' AS expected_project,
  current_database() AS database_name,
  current_user AS database_user,
  now() AS checked_at;

WITH required_objects(object_name, object_oid) AS (
  VALUES
    ('public.patient_material_costs', to_regclass('public.patient_material_costs')::oid),
    ('public.material_lab_cost_presets', to_regclass('public.material_lab_cost_presets')::oid),
    ('public.material_lab_cost_preset_settings', to_regclass('public.material_lab_cost_preset_settings')::oid),
    ('public.pending_commission_recalculations', to_regclass('public.pending_commission_recalculations')::oid),
    ('public.expenses', to_regclass('public.expenses')::oid),
    ('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)', to_regprocedure('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)')::oid),
    ('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)', to_regprocedure('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)')::oid)
)
SELECT object_name, object_oid IS NOT NULL AS present
FROM required_objects
ORDER BY object_name;

-- Every row must show present = true. This second result must contain zero rows.
WITH required_objects(object_name, object_oid) AS (
  VALUES
    ('public.patient_material_costs', to_regclass('public.patient_material_costs')::oid),
    ('public.material_lab_cost_presets', to_regclass('public.material_lab_cost_presets')::oid),
    ('public.material_lab_cost_preset_settings', to_regclass('public.material_lab_cost_preset_settings')::oid),
    ('public.pending_commission_recalculations', to_regclass('public.pending_commission_recalculations')::oid),
    ('public.expenses', to_regclass('public.expenses')::oid),
    ('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)', to_regprocedure('public.replace_treatment_costs(uuid,jsonb,uuid,text,uuid)')::oid),
    ('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)', to_regprocedure('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)')::oid)
)
SELECT object_name AS missing_prerequisite
FROM required_objects
WHERE object_oid IS NULL;

SELECT cost_type, COUNT(*) AS row_count, COALESCE(SUM(total_amount), 0) AS total_amount
FROM public.patient_material_costs
GROUP BY cost_type
ORDER BY cost_type;

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

SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 10;