-- Match Clinical Focus patient-history filters and deterministic newest-first ordering.
-- A short lock timeout prevents this production migration from waiting behind long-running
-- transactions; if either table is busy, deployment fails safely and can be retried later.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_treatments_patient_date_id
  ON public.treatments (patient_id, date DESC, id);

CREATE INDEX IF NOT EXISTS idx_medicine_sales_patient_date_id
  ON public.medicine_sales (patient_id, date DESC, id);

ANALYZE public.treatments;
ANALYZE public.medicine_sales;