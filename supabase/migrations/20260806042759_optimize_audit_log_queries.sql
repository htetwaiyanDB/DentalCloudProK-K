-- Match the Audit Log's branch/date filters and deterministic ordering.
CREATE INDEX IF NOT EXISTS idx_treatments_location_date_id
  ON public.treatments (location_id, date DESC, id);

CREATE INDEX IF NOT EXISTS idx_appointment_reschedule_logs_location_created_id
  ON public.appointment_reschedule_logs (location_id, created_at DESC, id);

ANALYZE public.treatments;
ANALYZE public.appointment_reschedule_logs;
