-- Add stable clinician IDs without changing the existing expense ledger rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

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
       COALESCE(p.location_id, t.location_id, a.location_id) AS location_id,
       CASE WHEN t.doctor_id IS NOT NULL THEN ARRAY[t.doctor_id]
            WHEN cardinality(linked.doctor_ids) > 0 THEN linked.doctor_ids
            WHEN a.doctor_id IS NOT NULL THEN ARRAY[a.doctor_id]
            ELSE ARRAY[]::UUID[] END AS doctor_ids
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
         string_agg(DISTINCT pd.name, ', ' ORDER BY pd.name) AS doctor_name,
         array_agg(DISTINCT pt.doctor_id) FILTER (WHERE pt.doctor_id IS NOT NULL) AS doctor_ids
  FROM public.treatments pt
  LEFT JOIN public.doctors pd ON pd.id = pt.doctor_id
  WHERE pt.id = ANY(COALESCE(p.treatment_ids, ARRAY[]::UUID[]))
) linked ON true;
GRANT SELECT ON public.mls_expense_report TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;